use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, HashMap},
    hash::{Hash, Hasher},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use uuid::Uuid;

const MAX_TOOL_NAME_LENGTH: usize = 64;

#[derive(Clone, Debug, Default)]
pub(crate) struct ChatProtocolContext {
    tools: HashMap<String, ResponseTool>,
}

#[derive(Clone, Debug)]
enum ResponseTool {
    Function {
        name: String,
        namespace: Option<String>,
    },
    Custom {
        name: String,
    },
}

#[derive(Debug, Default)]
struct ToolCallState {
    call_id: String,
    name: String,
    arguments: String,
    output_index: Option<u32>,
    item_id: String,
    added: bool,
    done: bool,
}

#[derive(Debug, Default)]
struct OutputTextState {
    output_index: Option<u32>,
    item_id: String,
    text: String,
    added: bool,
    done: bool,
}

#[derive(Debug, Default)]
struct ReasoningState {
    output_index: Option<u32>,
    item_id: String,
    text: String,
    added: bool,
    done: bool,
}

#[derive(Debug)]
struct ChatStreamState {
    response_id: String,
    model: String,
    created_at: u64,
    response_started: bool,
    completed: bool,
    next_output_index: u32,
    text: OutputTextState,
    reasoning: ReasoningState,
    tools: BTreeMap<usize, ToolCallState>,
    output_items: Vec<(u32, Value)>,
    usage: Option<Value>,
    finish_reason: Option<String>,
    context: ChatProtocolContext,
}

impl ChatStreamState {
    fn new(context: ChatProtocolContext) -> Self {
        Self {
            response_id: format!("resp_{}", Uuid::new_v4().simple()),
            model: String::new(),
            created_at: now_seconds(),
            response_started: false,
            completed: false,
            next_output_index: 0,
            text: OutputTextState::default(),
            reasoning: ReasoningState::default(),
            tools: BTreeMap::new(),
            output_items: Vec::new(),
            usage: None,
            finish_reason: None,
            context,
        }
    }

    fn response_value(&self, status: &str, output: Vec<Value>) -> Value {
        json!({
            "id": self.response_id,
            "object": "response",
            "created_at": self.created_at,
            "status": status,
            "model": self.model,
            "output": output,
            "usage": self.usage.clone().unwrap_or_else(empty_usage),
        })
    }

    fn ensure_started(&mut self, chunk: &Value) -> Vec<Vec<u8>> {
        if let Some(id) = chunk.get("id").and_then(Value::as_str) {
            self.response_id = response_id_from_chat_id(Some(id));
        }
        if let Some(model) = chunk.get("model").and_then(Value::as_str) {
            if !model.is_empty() {
                self.model = model.to_string();
            }
        }
        if let Some(created) = chunk.get("created").and_then(Value::as_u64) {
            self.created_at = created;
        }
        if self.response_started {
            return Vec::new();
        }
        self.response_started = true;
        let response = self.response_value("in_progress", Vec::new());
        vec![
            sse_event(
                "response.created",
                json!({"type": "response.created", "response": response}),
            ),
            sse_event(
                "response.in_progress",
                json!({"type": "response.in_progress", "response": response}),
            ),
        ]
    }

    fn handle_chunk(&mut self, chunk: &Value) -> Vec<Vec<u8>> {
        let mut events = self.ensure_started(chunk);
        if let Some(usage) = chunk.get("usage").filter(|value| !value.is_null()) {
            self.usage = Some(chat_usage_to_responses_usage(Some(usage)));
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return events;
        };

        if let Some(delta) = choice.get("delta") {
            if let Some(reasoning) = reasoning_text(delta) {
                events.extend(self.push_reasoning(&reasoning));
            }
            if let Some(content) = content_delta(delta) {
                if !content.is_empty() {
                    events.extend(self.push_text(&content));
                }
            }
            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for tool_call in tool_calls {
                    events.extend(self.push_tool_call(tool_call));
                }
            }
            if let Some(function_call) = delta.get("function_call") {
                events.extend(self.push_legacy_function_call(function_call));
            }
        }
        if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(finish_reason.to_string());
        }
        events
    }

    fn push_text(&mut self, delta: &str) -> Vec<Vec<u8>> {
        let mut events = Vec::new();
        if !self.text.added {
            let output_index = self.next_output_index();
            let item_id = format!("{}_msg", self.response_id);
            self.text.output_index = Some(output_index);
            self.text.item_id = item_id.clone();
            self.text.added = true;
            events.push(sse_event(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": item_id,
                        "type": "message",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": []
                    }
                }),
            ));
            events.push(sse_event(
                "response.content_part.added",
                json!({
                    "type": "response.content_part.added",
                    "item_id": self.text.item_id,
                    "output_index": output_index,
                    "content_index": 0,
                    "part": {"type": "output_text", "text": "", "annotations": []}
                }),
            ));
        }
        self.text.text.push_str(delta);
        events.push(sse_event(
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": self.text.item_id,
                "output_index": self.text.output_index.unwrap_or(0),
                "content_index": 0,
                "delta": delta
            }),
        ));
        events
    }

    fn push_reasoning(&mut self, delta: &str) -> Vec<Vec<u8>> {
        let mut events = Vec::new();
        if !self.reasoning.added {
            let output_index = self.next_output_index();
            let item_id = format!("{}_reasoning", self.response_id);
            self.reasoning.output_index = Some(output_index);
            self.reasoning.item_id = item_id.clone();
            self.reasoning.added = true;
            events.push(sse_event(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": item_id,
                        "type": "reasoning",
                        "status": "in_progress",
                        "summary": []
                    }
                }),
            ));
            events.push(sse_event(
                "response.reasoning_summary_part.added",
                json!({
                    "type": "response.reasoning_summary_part.added",
                    "item_id": self.reasoning.item_id,
                    "output_index": output_index,
                    "summary_index": 0,
                    "part": {"type": "summary_text", "text": ""}
                }),
            ));
        }
        self.reasoning.text.push_str(delta);
        events.push(sse_event(
            "response.reasoning_summary_text.delta",
            json!({
                "type": "response.reasoning_summary_text.delta",
                "item_id": self.reasoning.item_id,
                "output_index": self.reasoning.output_index.unwrap_or(0),
                "summary_index": 0,
                "delta": delta
            }),
        ));
        events
    }

    fn push_tool_call(&mut self, tool_call: &Value) -> Vec<Vec<u8>> {
        let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let function = tool_call.get("function").unwrap_or(&Value::Null);
        let call_id_delta = tool_call
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let name_delta = function
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let (was_added, call_id, name, all_arguments, item_id, output_index) = {
            let state = self.tools.entry(index).or_default();
            if !call_id_delta.is_empty() {
                state.call_id = call_id_delta.to_string();
            }
            if !name_delta.is_empty() {
                state.name = name_delta.to_string();
            }
            state.arguments.push_str(arguments);
            (
                state.added,
                state.call_id.clone(),
                state.name.clone(),
                state.arguments.clone(),
                state.item_id.clone(),
                state.output_index,
            )
        };

        let mut events = Vec::new();
        if !was_added && !name.is_empty() {
            let output_index = self.next_output_index();
            let call_id = if call_id.is_empty() {
                format!("call_{index}")
            } else {
                call_id
            };
            let item_id = response_tool_item_id(&call_id, &name, &self.context);
            if let Some(state) = self.tools.get_mut(&index) {
                state.call_id = call_id.clone();
                state.output_index = Some(output_index);
                state.item_id = item_id.clone();
                state.added = true;
            }
            let item = response_tool_call_item(
                &item_id,
                "in_progress",
                &call_id,
                &name,
                "",
                &self.context,
            );
            events.push(sse_event(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": item
                }),
            ));
            if !all_arguments.is_empty() && !is_custom_tool(&name, &self.context) {
                events.push(sse_event(
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": item_id,
                        "output_index": output_index,
                        "delta": all_arguments
                    }),
                ));
            }
        } else if was_added && !arguments.is_empty() && !is_custom_tool(&name, &self.context) {
            events.push(sse_event(
                "response.function_call_arguments.delta",
                json!({
                    "type": "response.function_call_arguments.delta",
                    "item_id": item_id,
                    "output_index": output_index.unwrap_or(0),
                    "delta": arguments
                }),
            ));
        }
        events
    }

    fn push_legacy_function_call(&mut self, function_call: &Value) -> Vec<Vec<u8>> {
        let call = json!({
            "index": 0,
            "id": function_call.get("id").cloned().unwrap_or(Value::Null),
            "function": function_call
        });
        self.push_tool_call(&call)
    }

    fn finalize(&mut self) -> Vec<Vec<u8>> {
        if self.completed {
            return Vec::new();
        }
        let mut events = Vec::new();
        if !self.response_started {
            events.extend(self.ensure_started(&json!({})));
        }
        if self.reasoning.added && !self.reasoning.done {
            let index = self.reasoning.output_index.unwrap_or(0);
            let item = json!({
                "id": self.reasoning.item_id,
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": self.reasoning.text}]
            });
            events.push(sse_event(
                "response.reasoning_summary_text.done",
                json!({
                    "type": "response.reasoning_summary_text.done",
                    "item_id": self.reasoning.item_id,
                    "output_index": index,
                    "summary_index": 0,
                    "text": self.reasoning.text
                }),
            ));
            events.push(sse_event(
                "response.reasoning_summary_part.done",
                json!({
                    "type": "response.reasoning_summary_part.done",
                    "item_id": self.reasoning.item_id,
                    "output_index": index,
                    "summary_index": 0,
                    "part": {"type": "summary_text", "text": self.reasoning.text}
                }),
            ));
            events.push(sse_event(
                "response.output_item.done",
                json!({"type": "response.output_item.done", "output_index": index, "item": item.clone()}),
            ));
            self.output_items.push((index, item));
            self.reasoning.done = true;
        }
        if self.text.added && !self.text.done {
            let index = self.text.output_index.unwrap_or(0);
            let item = json!({
                "id": self.text.item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": self.text.text, "annotations": []}]
            });
            events.push(sse_event(
                "response.output_text.done",
                json!({
                    "type": "response.output_text.done",
                    "item_id": self.text.item_id,
                    "output_index": index,
                    "content_index": 0,
                    "text": self.text.text
                }),
            ));
            events.push(sse_event(
                "response.content_part.done",
                json!({
                    "type": "response.content_part.done",
                    "item_id": self.text.item_id,
                    "output_index": index,
                    "content_index": 0,
                    "part": {"type": "output_text", "text": self.text.text, "annotations": []}
                }),
            ));
            events.push(sse_event(
                "response.output_item.done",
                json!({"type": "response.output_item.done", "output_index": index, "item": item.clone()}),
            ));
            self.output_items.push((index, item));
            self.text.done = true;
        }

        let tool_indexes: Vec<usize> = self.tools.keys().copied().collect();
        for tool_index in tool_indexes {
            let Some(snapshot) = self.tools.get(&tool_index).map(|state| {
                (
                    state.done,
                    state.added,
                    state.call_id.clone(),
                    state.name.clone(),
                    state.arguments.clone(),
                    state.item_id.clone(),
                    state.output_index,
                )
            }) else {
                continue;
            };
            let (done, added, mut call_id, name, arguments, mut item_id, mut output_index) =
                snapshot;
            if done {
                continue;
            }
            if !added {
                if name.is_empty() {
                    if let Some(state) = self.tools.get_mut(&tool_index) {
                        state.done = true;
                    }
                    continue;
                }
                output_index = Some(self.next_output_index());
                call_id = if call_id.is_empty() {
                    format!("call_{tool_index}")
                } else {
                    call_id
                };
                item_id = response_tool_item_id(&call_id, &name, &self.context);
                if let Some(state) = self.tools.get_mut(&tool_index) {
                    state.call_id = call_id.clone();
                    state.output_index = output_index;
                    state.item_id = item_id.clone();
                    state.added = true;
                }
                let item = response_tool_call_item(
                    &item_id,
                    "in_progress",
                    &call_id,
                    &name,
                    "",
                    &self.context,
                );
                events.push(sse_event(
                    "response.output_item.added",
                    json!({"type": "response.output_item.added", "output_index": output_index.unwrap_or(0), "item": item}),
                ));
            }
            let output_index = output_index.unwrap_or(0);
            let arguments = canonical_arguments(&arguments);
            let item = response_tool_call_item(
                &item_id,
                "completed",
                &call_id,
                &name,
                &arguments,
                &self.context,
            );
            if is_custom_tool(&name, &self.context) {
                let input = custom_tool_input(&arguments);
                events.push(sse_event(
                    "response.custom_tool_call_input.done",
                    json!({
                        "type": "response.custom_tool_call_input.done",
                        "item_id": item_id,
                        "output_index": output_index,
                        "input": input
                    }),
                ));
            } else {
                events.push(sse_event(
                    "response.function_call_arguments.done",
                    json!({
                        "type": "response.function_call_arguments.done",
                        "item_id": item_id,
                        "output_index": output_index,
                        "arguments": arguments
                    }),
                ));
            }
            events.push(sse_event(
                "response.output_item.done",
                json!({"type": "response.output_item.done", "output_index": output_index, "item": item.clone()}),
            ));
            self.output_items.push((output_index, item));
            if let Some(state) = self.tools.get_mut(&tool_index) {
                state.done = true;
            }
        }

        self.output_items.sort_by_key(|(index, _)| *index);
        let output = self
            .output_items
            .iter()
            .map(|(_, item)| item.clone())
            .collect::<Vec<_>>();
        let status = response_status_from_finish_reason(self.finish_reason.as_deref());
        let mut response = self.response_value(status, output);
        if status == "incomplete" {
            response["incomplete_details"] = json!({"reason": "max_output_tokens"});
        }
        events.push(sse_event(
            "response.completed",
            json!({"type": "response.completed", "response": response}),
        ));
        self.completed = true;
        events
    }

    fn fail(&mut self, message: impl Into<String>, error_type: &str) -> Vec<Vec<u8>> {
        if self.completed {
            return Vec::new();
        }
        if !self.response_started {
            self.response_started = true;
        }
        let mut response = self.response_value("failed", Vec::new());
        response["error"] = json!({"message": message.into(), "type": error_type});
        self.completed = true;
        vec![sse_event(
            "response.failed",
            json!({"type": "response.failed", "response": response}),
        )]
    }

    fn next_output_index(&mut self) -> u32 {
        let index = self.next_output_index;
        self.next_output_index += 1;
        index
    }
}

pub(crate) struct ChatSseConverter {
    buffer: Vec<u8>,
    state: ChatStreamState,
    saw_done: bool,
}

impl ChatSseConverter {
    pub(crate) fn new(context: ChatProtocolContext) -> Self {
        Self {
            buffer: Vec::new(),
            state: ChatStreamState::new(context),
            saw_done: false,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(block) = take_sse_block(&mut self.buffer) {
            events.extend(self.handle_block(&block));
            if self.saw_done {
                break;
            }
        }
        events
    }

    pub(crate) fn finish(&mut self) -> Vec<Vec<u8>> {
        let mut events = Vec::new();
        if !self.buffer.is_empty() && !self.saw_done {
            let block = std::mem::take(&mut self.buffer);
            events.extend(self.handle_block(&block));
        }
        if !self.saw_done {
            events.extend(self.state.finalize());
            self.saw_done = true;
        }
        events
    }

    pub(crate) fn fail(&mut self, message: impl Into<String>) -> Vec<Vec<u8>> {
        if self.saw_done {
            return Vec::new();
        }
        self.saw_done = true;
        self.state.fail(message, "stream_error")
    }

    pub(crate) fn is_finished(&self) -> bool {
        self.saw_done
    }

    fn handle_block(&mut self, block: &[u8]) -> Vec<Vec<u8>> {
        let text = String::from_utf8_lossy(block);
        let mut event_name = None;
        let mut data = Vec::new();
        for line in text.lines() {
            if let Some(value) = line.strip_prefix("event:") {
                event_name = Some(value.trim());
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push(value.trim_start().to_string());
            }
        }
        if data.is_empty() {
            return Vec::new();
        }
        let data = data.join("\n");
        if data.trim() == "[DONE]" {
            self.saw_done = true;
            return self.state.finalize();
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return Vec::new();
        };
        if event_name == Some("error") || value.get("error").is_some() {
            self.saw_done = true;
            return self.state.fail(
                error_message(&value),
                error_type(&value).as_deref().unwrap_or("upstream_error"),
            );
        }
        self.state.handle_chunk(&value)
    }
}

pub(crate) fn responses_request_to_chat(
    body: Value,
) -> Result<(Value, ChatProtocolContext), String> {
    let object = body
        .as_object()
        .ok_or_else(|| "Responses request body must be a JSON object".to_string())?;
    let mut context = ChatProtocolContext::default();
    let mut result = Map::new();
    if let Some(model) = object.get("model") {
        result.insert("model".into(), model.clone());
    }

    let mut messages = Vec::new();
    if let Some(instructions) = object.get("instructions") {
        let text = content_text(instructions);
        if !text.is_empty() {
            messages.push(json!({"role": "system", "content": text}));
        }
    }
    if let Some(input) = object.get("input") {
        append_input(input, &mut messages, &mut context)?;
    }
    result.insert("messages".into(), Value::Array(messages));

    for key in [
        "temperature",
        "top_p",
        "stream",
        "response_format",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "stop",
        "user",
        "metadata",
        "parallel_tool_calls",
        "logprobs",
        "top_logprobs",
        "n",
        "service_tier",
    ] {
        if let Some(value) = object.get(key) {
            result.insert(key.into(), value.clone());
        }
    }
    if let Some(max_tokens) = object
        .get("max_output_tokens")
        .or_else(|| object.get("max_tokens"))
    {
        result.insert("max_tokens".into(), max_tokens.clone());
    }
    if let Some(reasoning) = object
        .get("reasoning")
        .and_then(|value| value.get("effort"))
    {
        result.insert("reasoning_effort".into(), reasoning.clone());
    }

    let mut chat_tools = Vec::new();
    if let Some(tools) = object.get("tools").and_then(Value::as_array) {
        for tool in tools {
            if let Some(chat_tool) = convert_tool(tool, &mut context) {
                chat_tools.push(chat_tool);
            }
        }
    }
    if !chat_tools.is_empty() {
        result.insert("tools".into(), Value::Array(chat_tools));
        if let Some(choice) = object.get("tool_choice") {
            result.insert("tool_choice".into(), convert_tool_choice(choice));
        }
    }
    if object
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let stream_options = result.entry("stream_options").or_insert_with(|| json!({}));
        if let Some(options) = stream_options.as_object_mut() {
            options.insert("include_usage".into(), Value::Bool(true));
        }
    }
    Ok((Value::Object(result), context))
}

pub(crate) fn chat_response_to_responses(
    body: Value,
    context: &ChatProtocolContext,
) -> Result<Value, String> {
    let choices = body
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| "Chat Completions response has no choices".to_string())?;
    let choice = choices
        .first()
        .ok_or_else(|| "Chat Completions response has no choices".to_string())?;
    let message = choice
        .get("message")
        .ok_or_else(|| "Chat Completions response has no message".to_string())?;
    let response_id = response_id_from_chat_id(body.get("id").and_then(Value::as_str));
    let finish_reason = choice.get("finish_reason").and_then(Value::as_str);
    let mut output = Vec::new();
    if let Some(reasoning) = reasoning_text(message) {
        if !reasoning.is_empty() {
            output.push(json!({
                "id": format!("{}_reasoning", response_id),
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": reasoning}]
            }));
        }
    }
    if let Some(message_item) = response_message_item(message, &response_id) {
        output.push(message_item);
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, tool_call) in tool_calls.iter().enumerate() {
            if let Some(item) = response_tool_call_from_chat(tool_call, index, context) {
                output.push(item);
            }
        }
    } else if let Some(function_call) = message.get("function_call") {
        let tool_call = json!({"id": format!("call_{response_id}"), "function": function_call});
        if let Some(item) = response_tool_call_from_chat(&tool_call, 0, context) {
            output.push(item);
        }
    }

    let status = response_status_from_finish_reason(finish_reason);
    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": body.get("created").and_then(Value::as_u64).unwrap_or_else(now_seconds),
        "status": status,
        "model": body.get("model").cloned().unwrap_or(Value::Null),
        "output": output,
        "usage": chat_usage_to_responses_usage(body.get("usage"))
    });
    if status == "incomplete" {
        response["incomplete_details"] = json!({"reason": "max_output_tokens"});
    }
    Ok(response)
}

pub(crate) fn chat_error_to_response(body: Option<&Value>) -> Value {
    let value = body.unwrap_or(&Value::Null);
    let error = value.get("error").unwrap_or(value);
    let message = error
        .get("message")
        .or_else(|| error.get("detail"))
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("Upstream Chat Completions request failed");
    let error_type = error
        .get("type")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("upstream_error");
    json!({
        "error": {
            "message": message,
            "type": error_type,
            "code": error.get("code").cloned().unwrap_or(Value::Null),
            "param": error.get("param").cloned().unwrap_or(Value::Null)
        }
    })
}

pub(crate) fn is_responses_path(path: &str) -> bool {
    matches!(path, "/v1/responses" | "/v1/responses/compact")
}

pub(crate) fn chat_completions_path(path: &str) -> &'static str {
    let _ = path;
    "/v1/chat/completions"
}

fn append_input(
    input: &Value,
    messages: &mut Vec<Value>,
    _context: &mut ChatProtocolContext,
) -> Result<(), String> {
    let items: Vec<&Value> = match input {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![input],
        Value::String(_) => vec![input],
        _ => Vec::new(),
    };
    let mut pending_tool_calls = Vec::new();
    for item in items {
        let item_type = item.get("type").and_then(Value::as_str);
        match item_type {
            Some("function_call") | Some("custom_tool_call") => {
                let call_id = item
                    .get("call_id")
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
                if !name.is_empty() {
                    let arguments = if item_type == Some("custom_tool_call") {
                        json!({"input": item.get("input").cloned().unwrap_or_else(|| json!(""))})
                    } else {
                        item.get("arguments")
                            .cloned()
                            .unwrap_or_else(|| json!("{}"))
                    };
                    pending_tool_calls.push(json!({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": chat_tool_name(
                                name,
                                item.get("namespace").and_then(|value| value.as_str()),
                            ),
                            "arguments": canonical_arguments_value(&arguments)
                        }
                    }));
                }
            }
            Some("function_call_output")
            | Some("custom_tool_call_output")
            | Some("tool_search_output") => {
                flush_tool_calls(messages, &mut pending_tool_calls);
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let output = item
                    .get("output")
                    .or_else(|| item.get("content"))
                    .map(value_as_chat_text)
                    .unwrap_or_default();
                messages.push(json!({"role": "tool", "tool_call_id": call_id, "content": output}));
            }
            Some("reasoning") => {
                flush_tool_calls(messages, &mut pending_tool_calls);
                let text = content_text(item);
                if !text.is_empty() {
                    messages.push(
                        json!({"role": "assistant", "content": null, "reasoning_content": text}),
                    );
                }
            }
            Some("input_text") | Some("input_image") | Some("input_file") | Some("input_audio") => {
                flush_tool_calls(messages, &mut pending_tool_calls);
                let role = item
                    .get("role")
                    .and_then(Value::as_str)
                    .map(chat_role)
                    .unwrap_or("user");
                messages.push(json!({
                    "role": role,
                    "content": content_to_chat(item)
                }));
            }
            Some("message") | None => {
                if item.get("role").is_some() || item.get("content").is_some() {
                    flush_tool_calls(messages, &mut pending_tool_calls);
                    let role = item
                        .get("role")
                        .and_then(Value::as_str)
                        .map(chat_role)
                        .unwrap_or("user");
                    let mut message = json!({
                        "role": role,
                        "content": item.get("content").map(content_to_chat).unwrap_or(Value::Null)
                    });
                    if let Some(reasoning) = reasoning_text(item) {
                        message["reasoning_content"] = json!(reasoning);
                    }
                    messages.push(message);
                }
            }
            _ => {}
        }
    }
    flush_tool_calls(messages, &mut pending_tool_calls);
    if let Value::String(text) = input {
        messages.push(json!({"role": "user", "content": text}));
    }
    if messages.is_empty() {
        return Err("Responses request has no input messages".to_string());
    }
    Ok(())
}

fn flush_tool_calls(messages: &mut Vec<Value>, calls: &mut Vec<Value>) {
    if calls.is_empty() {
        return;
    }
    messages.push(json!({
        "role": "assistant",
        "content": null,
        "tool_calls": std::mem::take(calls)
    }));
}

fn convert_tool(tool: &Value, context: &mut ChatProtocolContext) -> Option<Value> {
    let kind = tool.get("type").and_then(Value::as_str)?;
    match kind {
        "function" => {
            let source = tool.get("function").unwrap_or(tool);
            let name = source.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            let namespace = tool
                .get("namespace")
                .and_then(Value::as_str)
                .map(str::to_string);
            let chat_name = chat_tool_name(name, namespace.as_deref());
            context.tools.insert(
                chat_name.clone(),
                ResponseTool::Function {
                    name: name.to_string(),
                    namespace,
                },
            );
            let mut function = json!({
                "name": chat_name,
                "description": source.get("description").cloned().unwrap_or(Value::Null),
                "parameters": source.get("parameters").cloned().unwrap_or_else(|| json!({"type": "object", "properties": {}}))
            });
            if let Some(strict) = source.get("strict").or_else(|| tool.get("strict")) {
                function["strict"] = strict.clone();
            }
            Some(json!({"type": "function", "function": function}))
        }
        "custom" => {
            let name = tool.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            context.tools.insert(
                name.to_string(),
                ResponseTool::Custom {
                    name: name.to_string(),
                },
            );
            Some(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description").cloned().unwrap_or(Value::Null),
                    "parameters": {
                        "type": "object",
                        "properties": {"input": {"type": "string"}},
                        "required": ["input"]
                    }
                }
            }))
        }
        _ => None,
    }
}

fn convert_tool_choice(choice: &Value) -> Value {
    match choice {
        Value::Object(object) if choice.get("type").and_then(Value::as_str) == Some("function") => {
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let namespace = object.get("namespace").and_then(Value::as_str);
            json!({
                "type": "function",
                "function": {"name": chat_tool_name(name, namespace)}
            })
        }
        _ => choice.clone(),
    }
}

fn content_to_chat(value: &Value) -> Value {
    if value.is_string() {
        return value.clone();
    }
    let parts: Vec<&Value> = if let Some(parts) = value
        .as_array()
        .or_else(|| value.get("content").and_then(Value::as_array))
    {
        parts.iter().collect()
    } else if value.get("type").is_some() {
        vec![value]
    } else {
        if value.get("text").is_some() {
            return json!([{"type": "text", "text": value.get("text").and_then(Value::as_str).unwrap_or_default()}]);
        }
        return value.clone();
    };
    let mut result = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str).unwrap_or("text") {
            "input_text" | "output_text" | "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    result.push(json!({"type": "text", "text": text}));
                }
            }
            "input_image" | "image_url" => {
                if let Some(image_url) = part.get("image_url") {
                    result.push(json!({
                        "type": "image_url",
                        "image_url": if image_url.is_object() { image_url.clone() } else { json!({"url": image_url}) }
                    }));
                }
            }
            "input_file" | "file" => {
                let file = part.get("file").unwrap_or(part);
                if file.get("file_data").is_some()
                    || file.get("file_url").is_some()
                    || file.get("url").is_some()
                {
                    result.push(json!({"type": "file", "file": file.clone()}));
                } else {
                    result.push(json!({"type": "text", "text": format!("[file: {}]", file.get("filename").and_then(Value::as_str).unwrap_or("unnamed"))}));
                }
            }
            "input_audio" => {
                result.push(json!({"type": "input_audio", "input_audio": part.get("input_audio").cloned().unwrap_or_else(|| part.clone())}));
            }
            "refusal" => {
                if let Some(text) = part.get("refusal").and_then(Value::as_str) {
                    result.push(json!({"type": "text", "text": text}));
                }
            }
            _ => {}
        }
    }
    if result.is_empty() {
        Value::String(content_text(value))
    } else {
        Value::Array(result)
    }
}

fn content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("refusal"))
                    .and_then(Value::as_str)
            })
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(object) => object
            .get("text")
            .or_else(|| object.get("content"))
            .map(content_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn value_as_chat_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn chat_role(role: &str) -> &'static str {
    match role {
        "system" | "developer" => "system",
        "assistant" => "assistant",
        "tool" => "tool",
        _ => "user",
    }
}

fn reasoning_text(value: &Value) -> Option<String> {
    value
        .get("reasoning_content")
        .or_else(|| value.get("reasoning"))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.get("summary").map(content_text))
        })
        .filter(|text| !text.is_empty())
}

fn content_delta(value: &Value) -> Option<String> {
    match value.get("content") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Array(parts)) => Some(content_text(&Value::Array(parts.clone()))),
        _ => None,
    }
}

fn response_message_item(message: &Value, response_id: &str) -> Option<Value> {
    let mut content = Vec::new();
    match message.get("content") {
        Some(Value::String(text)) if !text.is_empty() => {
            content.push(json!({"type": "output_text", "text": text, "annotations": []}));
        }
        Some(Value::Array(parts)) => {
            for part in parts {
                if let Some(text) = part
                    .get("text")
                    .or_else(|| part.get("content"))
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        content
                            .push(json!({"type": "output_text", "text": text, "annotations": []}));
                    }
                }
                if let Some(refusal) = part.get("refusal").and_then(Value::as_str) {
                    content.push(json!({"type": "refusal", "refusal": refusal}));
                }
            }
        }
        _ => {}
    }
    if let Some(refusal) = message.get("refusal").and_then(Value::as_str) {
        content.push(json!({"type": "refusal", "refusal": refusal}));
    }
    if content.is_empty() {
        return None;
    }
    Some(json!({
        "id": format!("{}_msg", response_id),
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": content
    }))
}

fn response_tool_call_from_chat(
    tool_call: &Value,
    _index: usize,
    context: &ChatProtocolContext,
) -> Option<Value> {
    let function = tool_call.get("function").unwrap_or(tool_call);
    let name = function.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let call_id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            // This branch only creates a stable fallback for malformed providers.
            "call_0"
        });
    let arguments = canonical_arguments(
        function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let item_id = response_tool_item_id(call_id, name, context);
    Some(response_tool_call_item(
        &item_id,
        "completed",
        call_id,
        name,
        &arguments,
        context,
    ))
}

fn response_tool_item_id(call_id: &str, name: &str, context: &ChatProtocolContext) -> String {
    if is_custom_tool(name, context) {
        format!("ctc_{call_id}")
    } else {
        format!("fc_{call_id}")
    }
}

fn response_tool_call_item(
    item_id: &str,
    status: &str,
    call_id: &str,
    chat_name: &str,
    arguments: &str,
    context: &ChatProtocolContext,
) -> Value {
    match context.tools.get(chat_name) {
        Some(ResponseTool::Custom { name }) => json!({
            "id": item_id,
            "type": "custom_tool_call",
            "status": status,
            "call_id": call_id,
            "name": name,
            "input": custom_tool_input(arguments)
        }),
        Some(ResponseTool::Function { name, namespace }) => {
            let mut item = json!({
                "id": item_id,
                "type": "function_call",
                "status": status,
                "call_id": call_id,
                "name": name,
                "arguments": arguments
            });
            if let Some(namespace) = namespace {
                item["namespace"] = json!(namespace);
            }
            item
        }
        None => json!({
            "id": item_id,
            "type": "function_call",
            "status": status,
            "call_id": call_id,
            "name": chat_name,
            "arguments": arguments
        }),
    }
}

fn is_custom_tool(name: &str, context: &ChatProtocolContext) -> bool {
    matches!(context.tools.get(name), Some(ResponseTool::Custom { .. }))
}

fn custom_tool_input(arguments: &str) -> String {
    serde_json::from_str::<Value>(arguments)
        .ok()
        .and_then(|value| {
            value
                .get("input")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| arguments.to_string())
}

fn canonical_arguments_value(value: &Value) -> String {
    canonical_arguments(&value_as_chat_text(value))
}

fn canonical_arguments(value: &str) -> String {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| value.to_string())
}

fn chat_tool_name(name: &str, namespace: Option<&str>) -> String {
    let Some(namespace) = namespace.filter(|value| !value.is_empty()) else {
        return name.to_string();
    };
    let full = format!("{namespace}__{name}");
    if full.len() <= MAX_TOOL_NAME_LENGTH {
        return full;
    }
    let mut hasher = DefaultHasher::new();
    full.hash(&mut hasher);
    let suffix = format!("__{:08x}", hasher.finish() as u32);
    let prefix_len = MAX_TOOL_NAME_LENGTH.saturating_sub(suffix.len());
    format!(
        "{}{}",
        full.chars().take(prefix_len).collect::<String>(),
        suffix
    )
}

fn response_id_from_chat_id(id: Option<&str>) -> String {
    let id = id.unwrap_or("relayhub");
    if id.starts_with("resp_") {
        id.to_string()
    } else {
        format!("resp_{id}")
    }
}

fn response_status_from_finish_reason(reason: Option<&str>) -> &'static str {
    if reason == Some("length") {
        "incomplete"
    } else {
        "completed"
    }
}

fn chat_usage_to_responses_usage(usage: Option<&Value>) -> Value {
    let Some(usage) = usage.filter(|value| value.is_object()) else {
        return empty_usage();
    };
    let input = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total = usage
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input + output);
    let cached = usage
        .pointer("/prompt_tokens_details/cached_tokens")
        .or_else(|| usage.pointer("/input_tokens_details/cached_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    json!({
        "input_tokens": input,
        "output_tokens": output,
        "total_tokens": total,
        "input_tokens_details": {"cached_tokens": cached},
        "output_tokens_details": {
            "reasoning_tokens": usage.pointer("/completion_tokens_details/reasoning_tokens").and_then(Value::as_u64).unwrap_or(0)
        }
    })
}

fn empty_usage() -> Value {
    json!({
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens_details": {"reasoning_tokens": 0}
    })
}

fn error_message(value: &Value) -> String {
    let error = value.get("error").unwrap_or(value);
    error
        .get("message")
        .or_else(|| error.get("detail"))
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("Upstream Chat Completions stream failed")
        .to_string()
}

fn error_type(value: &Value) -> Option<String> {
    let error = value.get("error").unwrap_or(value);
    error
        .get("type")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn sse_event(event: &str, data: Value) -> Vec<u8> {
    format!(
        "event: {event}\ndata: {}\n\n",
        serde_json::to_string(&data).unwrap_or_default()
    )
    .into_bytes()
}

fn take_sse_block(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let mut separator = None;
    for index in 0..buffer.len().saturating_sub(1) {
        if buffer[index..].starts_with(b"\n\n") {
            separator = Some((index, 2));
            break;
        }
        if buffer[index..].starts_with(b"\r\n\r\n") {
            separator = Some((index, 4));
            break;
        }
    }
    let (index, length) = separator?;
    let block = buffer[..index].to_vec();
    buffer.drain(..index + length);
    Some(block)
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_responses_request_with_tools() {
        let (request, context) = responses_request_to_chat(json!({
            "model": "gpt-5-codex",
            "instructions": "Be concise.",
            "input": [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hello"}]},
                {"type": "function_call_output", "call_id": "call_1", "output": {"ok": true}}
            ],
            "tools": [{
                "type": "function",
                "name": "lookup",
                "parameters": {"type": "object", "properties": {}}
            }],
            "tool_choice": {"type": "function", "name": "lookup"},
            "reasoning": {"effort": "low"},
            "max_output_tokens": 1200,
            "stream": true
        })).unwrap();
        assert_eq!(request["messages"][0]["role"], "system");
        assert_eq!(request["messages"][1]["content"][0]["type"], "text");
        assert_eq!(request["messages"][2]["role"], "tool");
        assert_eq!(request["tools"][0]["function"]["name"], "lookup");
        assert_eq!(request["reasoning_effort"], "low");
        assert_eq!(request["stream_options"]["include_usage"], true);
        assert!(context.tools.contains_key("lookup"));
    }

    #[test]
    fn converts_standalone_input_parts_to_chat_content() {
        let (request, _) = responses_request_to_chat(json!({
            "model": "gpt-5-codex",
            "input": [
                {"type": "input_text", "text": "Describe this image."},
                {"type": "input_image", "image_url": "https://example.test/image.png"}
            ]
        }))
        .unwrap();
        assert_eq!(request["messages"][0]["content"][0]["type"], "text");
        assert_eq!(request["messages"][1]["content"][0]["type"], "image_url");
        assert_eq!(
            request["messages"][1]["content"][0]["image_url"]["url"],
            "https://example.test/image.png"
        );
    }

    #[test]
    fn converts_chat_response_to_responses() {
        let response = chat_response_to_responses(
            json!({
                "id": "chatcmpl_1",
                "created": 12,
                "model": "gpt-5-codex",
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "Hello"}
                }],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}
            }),
            &ChatProtocolContext::default(),
        )
        .unwrap();
        assert_eq!(response["id"], "resp_chatcmpl_1");
        assert_eq!(response["output"][0]["content"][0]["text"], "Hello");
        assert_eq!(response["usage"]["total_tokens"], 5);
    }

    #[test]
    fn converts_sse_across_chunk_boundaries() {
        let mut converter = ChatSseConverter::new(ChatProtocolContext::default());
        let first = b"data: {\"id\":\"chat_1\",\"model\":\"m\",\"created\":1,\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"he\"},\"finish_reason\":null}]}\n\n";
        let second = b"data: {\"choices\":[{\"delta\":{\"content\":\"llo\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        let mut output = converter.push(&first[..37]);
        output.extend(converter.push(&first[37..]));
        output.extend(converter.push(second));
        let text = String::from_utf8(output.concat()).unwrap();
        assert!(text.contains("response.output_text.delta"));
        assert!(text.contains("\"delta\":\"he\""));
        assert!(text.contains("\"delta\":\"llo\""));
        assert!(text.contains("response.completed"));
    }

    #[test]
    fn maps_chat_errors_to_responses_errors() {
        let error = chat_error_to_response(Some(&json!({
            "error": {"message": "bad request", "type": "invalid_request_error"}
        })));
        assert_eq!(error["error"]["message"], "bad request");
        assert_eq!(error["error"]["type"], "invalid_request_error");
    }
}
