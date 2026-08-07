-- Keep auth helper resolution independent from the caller's search path.
alter function public.relayhub_is_anonymous()
  set search_path = '';
