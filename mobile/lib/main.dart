import 'package:flutter/material.dart';

void main() => runApp(const RelayHubMobileApp());

enum RoutingMode { localGateway, direct }

enum KeyHealth { available, active, disabled, expired, depleted }

enum CommandState { pending, executing, succeeded, failed, expired }

abstract final class RelayColors {
  static const canvas = Color(0xFFF4F6F8);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFEEF1F4);
  static const ink = Color(0xFF111318);
  static const muted = Color(0xFF5E6673);
  static const faint = Color(0xFF98A2B3);
  static const line = Color(0xFFD8DEE8);
  static const blue = Color(0xFF146CFF);
  static const bluePressed = Color(0xFF0B55D4);
  static const blueSoft = Color(0xFFEAF1FF);
  static const dark = Color(0xFF15171C);
  static const danger = Color(0xFFB42318);
}

class RelayGroup {
  const RelayGroup({required this.name, required this.multiplier});

  final String name;
  final double multiplier;
}

class RelayKey {
  const RelayKey({
    required this.id,
    required this.name,
    required this.station,
    required this.maskedValue,
    required this.balance,
    required this.health,
    required this.group,
    this.expiresLabel,
  });

  final String id;
  final String name;
  final String station;
  final String maskedValue;
  final String balance;
  final KeyHealth health;
  final String group;
  final String? expiresLabel;

  bool get canActivate => health == KeyHealth.available;

  RelayKey copyWith({KeyHealth? health, String? group}) => RelayKey(
    id: id,
    name: name,
    station: station,
    maskedValue: maskedValue,
    balance: balance,
    health: health ?? this.health,
    group: group ?? this.group,
    expiresLabel: expiresLabel,
  );
}

class DeviceSnapshot {
  const DeviceSnapshot({
    required this.name,
    required this.online,
    required this.codexRunning,
    required this.routingMode,
    required this.lastSyncedLabel,
    required this.todaySpent,
    required this.todayRequests,
    required this.todayTokens,
    required this.activeKeyId,
  });

  final String name;
  final bool online;
  final bool codexRunning;
  final RoutingMode routingMode;
  final String lastSyncedLabel;
  final String todaySpent;
  final String todayRequests;
  final String todayTokens;
  final String activeKeyId;
}

class OperationRecord {
  const OperationRecord({
    required this.title,
    required this.detail,
    required this.state,
    required this.time,
  });

  final String title;
  final String detail;
  final CommandState state;
  final String time;
}

class MobileSnapshot {
  const MobileSnapshot({
    required this.device,
    required this.keys,
    required this.operations,
    required this.stationGroups,
  });

  final DeviceSnapshot device;
  final List<RelayKey> keys;
  final List<OperationRecord> operations;
  final Map<String, List<RelayGroup>> stationGroups;
}

abstract class MobileRepository {
  Future<MobileSnapshot> load();
  Future<MobileSnapshot> refreshKeys();
  Future<MobileSnapshot> activateKey(String keyId);
  Future<MobileSnapshot> updateKeyGroup(String keyId, String group);
}

class DemoMobileRepository implements MobileRepository {
  DemoMobileRepository();

  late MobileSnapshot _snapshot = MobileSnapshot(
    device: const DeviceSnapshot(
      name: 'Wecoo 的工作电脑',
      online: true,
      codexRunning: true,
      routingMode: RoutingMode.localGateway,
      lastSyncedLabel: '刚刚同步',
      todaySpent: '¥ 18.42',
      todayRequests: '1,284',
      todayTokens: '6.8M',
      activeKeyId: 'key-atlas',
    ),
    keys: const [
      RelayKey(
        id: 'key-atlas',
        name: 'Atlas · 主力',
        station: 'Northstar Relay',
        maskedValue: '…7X9K',
        balance: '¥ 284.60',
        health: KeyHealth.active,
        group: 'default',
        expiresLabel: '长期有效',
      ),
      RelayKey(
        id: 'key-cobalt',
        name: 'Cobalt · 编码',
        station: 'Northstar Relay',
        maskedValue: '…2QF1',
        balance: '¥ 96.20',
        health: KeyHealth.available,
        group: 'coding',
        expiresLabel: '剩余 42 天',
      ),
      RelayKey(
        id: 'key-vector',
        name: 'Vector · 备用',
        station: 'Relay One',
        maskedValue: '…M48P',
        balance: '无限额度',
        health: KeyHealth.available,
        group: 'fallback',
        expiresLabel: '长期有效',
      ),
      RelayKey(
        id: 'key-sunset',
        name: 'Sunset · 已停用',
        station: 'Relay One',
        maskedValue: '…E12A',
        balance: '¥ 0.00',
        health: KeyHealth.depleted,
        group: 'default',
        expiresLabel: '额度已用尽',
      ),
    ],
    operations: const [
      OperationRecord(
        title: '已启用 Atlas · 主力',
        detail: '本地网关已切换到 Northstar Relay',
        state: CommandState.succeeded,
        time: '今天 10:24',
      ),
      OperationRecord(
        title: '同步完成',
        detail: '已获取 4 个脱敏 API 密钥',
        state: CommandState.succeeded,
        time: '今天 09:58',
      ),
      OperationRecord(
        title: '已更新 Cobalt · 编码 分组',
        detail: 'coding -> priority',
        state: CommandState.succeeded,
        time: '昨天 18:42',
      ),
      OperationRecord(
        title: '启用请求未完成',
        detail: 'Relay One 设备离线，请在设备恢复后重试',
        state: CommandState.failed,
        time: '昨天 16:08',
      ),
    ],
    stationGroups: const {
      'Northstar Relay': [
        RelayGroup(name: 'default', multiplier: 1),
        RelayGroup(name: 'coding', multiplier: 0.85),
        RelayGroup(name: 'priority', multiplier: 1.25),
      ],
      'Relay One': [
        RelayGroup(name: 'default', multiplier: 1),
        RelayGroup(name: 'fallback', multiplier: 0.8),
      ],
    },
  );

  @override
  Future<MobileSnapshot> load() async => _snapshot;

  @override
  Future<MobileSnapshot> refreshKeys() async {
    await Future<void>.delayed(const Duration(milliseconds: 360));
    _snapshot = MobileSnapshot(
      device: _snapshot.device,
      keys: _snapshot.keys,
      stationGroups: _snapshot.stationGroups,
      operations: [
        const OperationRecord(
          title: '密钥与分组已刷新',
          detail: '已获取所有站点的最新密钥分组',
          state: CommandState.succeeded,
          time: '刚刚',
        ),
        ..._snapshot.operations,
      ],
    );
    return _snapshot;
  }

  @override
  Future<MobileSnapshot> activateKey(String keyId) async {
    await Future<void>.delayed(const Duration(milliseconds: 420));
    final selected = _snapshot.keys.firstWhere((key) => key.id == keyId);
    _snapshot = MobileSnapshot(
      device: DeviceSnapshot(
        name: _snapshot.device.name,
        online: _snapshot.device.online,
        codexRunning: _snapshot.device.codexRunning,
        routingMode: _snapshot.device.routingMode,
        lastSyncedLabel: '刚刚同步',
        todaySpent: _snapshot.device.todaySpent,
        todayRequests: _snapshot.device.todayRequests,
        todayTokens: _snapshot.device.todayTokens,
        activeKeyId: keyId,
      ),
      keys: _snapshot.keys.map((key) {
        if (key.id == keyId) return key.copyWith(health: KeyHealth.active);
        return key.health == KeyHealth.active
            ? key.copyWith(health: KeyHealth.available)
            : key;
      }).toList(),
      operations: [
        OperationRecord(
          title: '已启用 ${selected.name}',
          detail: _snapshot.device.routingMode == RoutingMode.localGateway
              ? '本地网关已切换到 ${selected.station}'
              : 'Codex Desktop 已重启并应用新密钥',
          state: CommandState.succeeded,
          time: '刚刚',
        ),
        ..._snapshot.operations,
      ],
      stationGroups: _snapshot.stationGroups,
    );
    return _snapshot;
  }

  @override
  Future<MobileSnapshot> updateKeyGroup(String keyId, String group) async {
    await Future<void>.delayed(const Duration(milliseconds: 280));
    final selected = _snapshot.keys.firstWhere((key) => key.id == keyId);
    _snapshot = MobileSnapshot(
      device: _snapshot.device,
      keys: _snapshot.keys
          .map((key) => key.id == keyId ? key.copyWith(group: group) : key)
          .toList(),
      stationGroups: _snapshot.stationGroups,
      operations: [
        OperationRecord(
          title: '已更新 ${selected.name} 分组',
          detail: '${selected.group} -> $group',
          state: CommandState.succeeded,
          time: '刚刚',
        ),
        ..._snapshot.operations,
      ],
    );
    return _snapshot;
  }
}

class RelayHubMobileApp extends StatefulWidget {
  const RelayHubMobileApp({super.key, this.repository});

  final MobileRepository? repository;

  @override
  State<RelayHubMobileApp> createState() => _RelayHubMobileAppState();
}

class _RelayHubMobileAppState extends State<RelayHubMobileApp> {
  late final MobileRepository _repository =
      widget.repository ?? DemoMobileRepository();
  MobileSnapshot? _snapshot;
  int _tab = 0;
  String? _busyKeyId;
  bool _refreshingKeys = false;
  bool _biometricLock = true;
  bool _importantConfirmation = true;
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final snapshot = await _repository.load();
    if (mounted) setState(() => _snapshot = snapshot);
  }

  Future<void> _activate(RelayKey key) async {
    final snapshot = _snapshot!;
    if (!snapshot.device.online || !key.canActivate || _busyKeyId != null) {
      return;
    }
    if (snapshot.device.routingMode == RoutingMode.direct) {
      final accepted = await showModalBottomSheet<bool>(
        context: context,
        showDragHandle: true,
        builder: (context) => _RestartSheet(relayKey: key),
      );
      if (accepted != true) return;
    }
    setState(() => _busyKeyId = key.id);
    final next = await _repository.activateKey(key.id);
    if (!mounted) return;
    setState(() {
      _snapshot = next;
      _busyKeyId = null;
    });
    _messengerKey.currentState?.showSnackBar(
      SnackBar(content: Text('已启用 ${key.name}')),
    );
  }

  Future<void> _refreshKeys() async {
    if (_refreshingKeys) return;
    setState(() => _refreshingKeys = true);
    final next = await _repository.refreshKeys();
    if (!mounted) return;
    setState(() {
      _snapshot = next;
      _refreshingKeys = false;
    });
    _messengerKey.currentState?.showSnackBar(
      const SnackBar(content: Text('密钥和分组已刷新')),
    );
  }

  Future<void> _changeGroup(RelayKey key, String group) async {
    if (_busyKeyId != null || key.group == group) return;
    setState(() => _busyKeyId = key.id);
    final next = await _repository.updateKeyGroup(key.id, group);
    if (!mounted) return;
    setState(() {
      _snapshot = next;
      _busyKeyId = null;
    });
    _messengerKey.currentState?.showSnackBar(
      SnackBar(content: Text('${key.name} 已切换到 $group 分组')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RelayHub',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messengerKey,
      theme: _theme(),
      home: Builder(
        builder: (context) {
          final snapshot = _snapshot;
          return Scaffold(
            body: snapshot == null
                ? const Center(child: CircularProgressIndicator())
                : SafeArea(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 180),
                      child: switch (_tab) {
                        0 => _HomePage(
                          key: const ValueKey('home'),
                          snapshot: snapshot,
                          onKeys: () => setState(() => _tab = 1),
                          onDevice: () => setState(() => _tab = 2),
                        ),
                        1 => _KeysPage(
                          key: const ValueKey('keys'),
                          snapshot: snapshot,
                          busyKeyId: _busyKeyId,
                          onActivate: _activate,
                          isRefreshing: _refreshingKeys,
                          onRefresh: _refreshKeys,
                          onChangeGroup: _changeGroup,
                        ),
                        _ => _ProfilePage(
                          key: const ValueKey('profile'),
                          snapshot: snapshot,
                          biometricLock: _biometricLock,
                          importantConfirmation: _importantConfirmation,
                          onBiometricChanged: (value) =>
                              setState(() => _biometricLock = value),
                          onImportantConfirmationChanged: (value) =>
                              setState(() => _importantConfirmation = value),
                        ),
                      },
                    ),
                  ),
            bottomNavigationBar: DecoratedBox(
              decoration: const BoxDecoration(
                color: RelayColors.surface,
                border: Border(top: BorderSide(color: RelayColors.line)),
              ),
              child: NavigationBar(
                selectedIndex: _tab,
                onDestinationSelected: (index) => setState(() => _tab = index),
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.grid_view_outlined),
                    selectedIcon: Icon(Icons.grid_view_rounded),
                    label: '首页',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.key_outlined),
                    selectedIcon: Icon(Icons.key_rounded),
                    label: 'API 密钥',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.person_outline_rounded),
                    selectedIcon: Icon(Icons.person_rounded),
                    label: '我的',
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

ThemeData _theme() {
  const blue = RelayColors.blue;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: blue,
        brightness: Brightness.light,
      ).copyWith(
        primary: blue,
        onPrimary: Colors.white,
        surface: RelayColors.surface,
        onSurface: RelayColors.ink,
        surfaceContainerHighest: RelayColors.surfaceMuted,
        outline: RelayColors.line,
        error: RelayColors.danger,
      );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: RelayColors.canvas,
    useMaterial3: true,
    splashFactory: InkSparkle.splashFactory,
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        fontSize: 28,
        height: 1.2,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
      ),
      titleLarge: TextStyle(
        fontSize: 20,
        height: 1.3,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        height: 1.35,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      titleSmall: TextStyle(
        fontSize: 14,
        height: 1.4,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      bodyLarge: TextStyle(fontSize: 16, height: 1.5, letterSpacing: 0),
      bodyMedium: TextStyle(fontSize: 14, height: 1.5, letterSpacing: 0),
      bodySmall: TextStyle(fontSize: 12, height: 1.45, letterSpacing: 0),
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      labelSmall: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
    ),
    cardTheme: const CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: RelayColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
        side: BorderSide(color: RelayColors.line),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: RelayColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: RelayColors.blueSoft,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
          color: states.contains(WidgetState.selected)
              ? blue
              : RelayColors.muted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? blue
              : RelayColors.muted,
        ),
      ),
      height: 68,
      elevation: 0,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.pressed)
              ? RelayColors.bluePressed
              : states.contains(WidgetState.disabled)
              ? RelayColors.line
              : blue,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? RelayColors.muted
              : Colors.white,
        ),
        minimumSize: const WidgetStatePropertyAll(Size(84, 48)),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
        shape: const WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(6)),
          ),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: RelayColors.ink,
        minimumSize: const Size(84, 48),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(6)),
        ),
        side: const BorderSide(color: RelayColors.line),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: RelayColors.blue,
        minimumSize: const Size(48, 48),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(6)),
        ),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: RelayColors.ink,
        minimumSize: const Size(48, 48),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(6)),
        ),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: const WidgetStatePropertyAll(Colors.white),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? RelayColors.dark
            : RelayColors.line,
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: RelayColors.surface,
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: TextStyle(color: RelayColors.muted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
        borderSide: BorderSide(color: RelayColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
        borderSide: BorderSide(color: RelayColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
        borderSide: BorderSide(color: RelayColors.blue, width: 1.5),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: RelayColors.surface,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: RelayColors.surface,
      modalBarrierColor: Color(0x99000000),
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: RelayColors.dark,
      contentTextStyle: TextStyle(color: Colors.white, fontSize: 14),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
      ),
    ),
    dividerTheme: const DividerThemeData(color: RelayColors.line, space: 1),
  );
}

class _Page extends StatelessWidget {
  const _Page({
    required this.title,
    required this.child,
    this.action = const SizedBox.shrink(),
    this.subtitle,
  });
  final String title;
  final Widget child;
  final Widget action;
  final String? subtitle;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 24),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                            color: RelayColors.blue,
                            borderRadius: BorderRadius.all(Radius.circular(2)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'RELAYHUB',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: RelayColors.muted,
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const Spacer(),
                        const _SystemSignal(),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: Theme.of(context).textTheme.headlineMedium,
                          ),
                        ),
                        action,
                      ],
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        subtitle!,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: RelayColors.muted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverToBoxAdapter(child: child),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
          ],
        ),
      ),
    ),
  );
}

class _SystemSignal extends StatelessWidget {
  const _SystemSignal();

  @override
  Widget build(BuildContext context) => Semantics(
    label: '系统连接正常',
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: RelayColors.surface,
        border: Border.all(color: RelayColors.line),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              color: RelayColors.blue,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'CONNECTED',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: RelayColors.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    ),
  );
}

class _HomePage extends StatelessWidget {
  const _HomePage({
    super.key,
    required this.snapshot,
    required this.onKeys,
    required this.onDevice,
  });
  final MobileSnapshot snapshot;
  final VoidCallback onKeys;
  final VoidCallback onDevice;
  @override
  Widget build(BuildContext context) {
    final active = snapshot.keys.firstWhere(
      (key) => key.id == snapshot.device.activeKeyId,
    );
    final device = snapshot.device;
    return _Page(
      title: '概况',
      subtitle: '设备、额度与今日使用情况',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final singleColumn =
                  constraints.maxWidth < 340 ||
                  MediaQuery.textScalerOf(context).scale(1) > 1.25;
              final cardWidth = singleColumn
                  ? constraints.maxWidth
                  : (constraints.maxWidth - 12) / 2;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _StatCard(
                    width: cardWidth,
                    icon: device.online
                        ? Icons.desktop_windows_outlined
                        : Icons.desktop_access_disabled_outlined,
                    label: '设备状态',
                    value: device.online ? '在线' : '离线',
                    detail: device.online
                        ? 'Codex ${device.codexRunning ? '正在运行' : '未运行'}'
                        : '等待桌面端连接',
                    onTap: onDevice,
                  ),
                  _StatCard(
                    width: cardWidth,
                    icon: Icons.key_outlined,
                    label: '当前启用',
                    value: active.name,
                    detail:
                        '${active.station} · ${_routingLabel(device.routingMode)}',
                    onTap: onKeys,
                  ),
                  _StatCard(
                    width: cardWidth,
                    icon: Icons.account_balance_wallet_outlined,
                    label: '可用余额',
                    value: active.balance,
                    detail: active.expiresLabel ?? '无到期信息',
                  ),
                  _StatCard(
                    width: cardWidth,
                    icon: Icons.data_usage_outlined,
                    label: '今日消耗',
                    value: device.todaySpent,
                    detail:
                        '${device.todayRequests} 请求 · ${device.todayTokens} Tokens',
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 28),
          _SectionTitle(title: '同步状态', meta: device.lastSyncedLabel),
          const SizedBox(height: 10),
          _SyncPanel(
            online: device.online,
            lastSyncedLabel: device.lastSyncedLabel,
            onKeys: onKeys,
          ),
        ],
      ),
    );
  }
}

class _KeysPage extends StatefulWidget {
  const _KeysPage({
    super.key,
    required this.snapshot,
    required this.busyKeyId,
    required this.onActivate,
    required this.isRefreshing,
    required this.onRefresh,
    required this.onChangeGroup,
  });
  final MobileSnapshot snapshot;
  final String? busyKeyId;
  final ValueChanged<RelayKey> onActivate;
  final bool isRefreshing;
  final VoidCallback onRefresh;
  final Future<void> Function(RelayKey key, String group) onChangeGroup;
  @override
  State<_KeysPage> createState() => _KeysPageState();
}

class _KeysPageState extends State<_KeysPage> {
  String _query = '';
  KeyHealth? _filter;
  @override
  Widget build(BuildContext context) {
    final active = widget.snapshot.keys.firstWhere(
      (key) => key.id == widget.snapshot.device.activeKeyId,
    );
    final keys = widget.snapshot.keys
        .where(
          (key) =>
              (_filter == null || key.health == _filter) &&
              ('${key.name} ${key.station}'.toLowerCase().contains(
                _query.toLowerCase(),
              )),
        )
        .toList();
    return _Page(
      title: 'API 密钥',
      subtitle: '管理密钥状态、站点分组与启用切换',
      action: _HeaderIconButton(
        tooltip: '刷新密钥和分组',
        onPressed: widget.isRefreshing ? null : widget.onRefresh,
        child: widget.isRefreshing
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.refresh_rounded, size: 22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _ActiveKeyBanner(
            relayKey: active,
            mode: widget.snapshot.device.routingMode,
          ),
          const SizedBox(height: 16),
          TextField(
            onChanged: (value) => setState(() => _query = value),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search_rounded),
              hintText: '搜索密钥或站点',
            ),
            minLines: 1,
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _FilterChip(
                  label: '全部',
                  selected: _filter == null,
                  onTap: () => setState(() => _filter = null),
                ),
                _FilterChip(
                  label: '可用',
                  selected: _filter == KeyHealth.available,
                  onTap: () => setState(() => _filter = KeyHealth.available),
                ),
                _FilterChip(
                  label: '已启用',
                  selected: _filter == KeyHealth.active,
                  onTap: () => setState(() => _filter = KeyHealth.active),
                ),
                _FilterChip(
                  label: '异常',
                  selected: _filter == KeyHealth.depleted,
                  onTap: () => setState(() => _filter = KeyHealth.depleted),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _SectionTitle(title: '密钥列表', meta: '${keys.length} 个'),
          const SizedBox(height: 10),
          if (keys.isEmpty)
            const _EmptyState()
          else
            ...keys.map(
              (key) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _KeyCard(
                  relayKey: key,
                  online: widget.snapshot.device.online,
                  loading: widget.busyKeyId == key.id,
                  onActivate: () => widget.onActivate(key),
                  groups:
                      widget.snapshot.stationGroups[key.station] ?? const [],
                  onChangeGroup: (group) => widget.onChangeGroup(key, group),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProfilePage extends StatelessWidget {
  const _ProfilePage({
    super.key,
    required this.snapshot,
    required this.biometricLock,
    required this.importantConfirmation,
    required this.onBiometricChanged,
    required this.onImportantConfirmationChanged,
  });
  final MobileSnapshot snapshot;
  final bool biometricLock;
  final bool importantConfirmation;
  final ValueChanged<bool> onBiometricChanged;
  final ValueChanged<bool> onImportantConfirmationChanged;
  @override
  Widget build(BuildContext context) => _Page(
    title: '我的',
    subtitle: '账号、设备与安全偏好',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _AccountPanel(
          name: 'Wecoo',
          email: 'wecoo@example.com',
          onTap: () => _infoSheet(
            context,
            title: '账号信息',
            icon: Icons.person_outline_rounded,
            lines: const ['Wecoo', 'wecoo@example.com', 'RelayHub 标准账户'],
          ),
        ),
        const SizedBox(height: 28),
        const _SectionTitle(title: '已配对电脑', meta: '1 台'),
        const SizedBox(height: 10),
        _DeviceCard(
          device: snapshot.device,
          onTap: () => _deviceSheet(context, snapshot.device),
        ),
        const SizedBox(height: 28),
        const _SectionTitle(title: '最近操作', meta: '最近 3 条'),
        const SizedBox(height: 10),
        _OperationPanel(operations: snapshot.operations.take(3).toList()),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => _OperationHistoryPage(
                  operations: snapshot.operations,
                ),
              ),
            ),
            icon: const Icon(Icons.arrow_forward_rounded, size: 18),
            label: const Text('查看更多'),
          ),
        ),
        const SizedBox(height: 28),
        const _SectionTitle(title: '安全设置'),
        const SizedBox(height: 10),
        Card(
          child: Column(
            children: [
              _SwitchSettingRow(
                icon: Icons.fingerprint_rounded,
                title: '生物识别解锁',
                subtitle: '启用密钥前验证身份',
                value: biometricLock,
                onChanged: onBiometricChanged,
              ),
              const Divider(),
              _SwitchSettingRow(
                icon: Icons.verified_user_outlined,
                title: '重要操作二次确认',
                subtitle: '切换密钥和解除绑定前确认',
                value: importantConfirmation,
                onChanged: onImportantConfirmationChanged,
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        const _SectionTitle(title: '偏好与支持'),
        const SizedBox(height: 10),
        Card(
          child: Column(
            children: [
              _SettingsRow(
                icon: Icons.notifications_none_rounded,
                title: '通知设置',
                subtitle: '设备离线、命令结果与额度提醒',
                onTap: () => _infoSheet(
                  context,
                  title: '通知设置',
                  icon: Icons.notifications_none_rounded,
                  lines: const ['设备状态通知：已开启', '命令结果通知：已开启', '额度提醒：低于 20%'],
                ),
              ),
              const Divider(),
              _SettingsRow(
                icon: Icons.history_rounded,
                title: '操作历史',
                subtitle: '查看全部远程命令记录',
                onTap: () => _infoSheet(
                  context,
                  title: '操作历史',
                  icon: Icons.history_rounded,
                  lines: snapshot.operations
                      .map((item) => '${item.time} · ${item.title}')
                      .toList(),
                ),
              ),
              const Divider(),
              _SettingsRow(
                icon: Icons.help_outline_rounded,
                title: '关于与帮助',
                subtitle: '版本、隐私与使用支持',
                onTap: () => _infoSheet(
                  context,
                  title: '关于 RelayHub',
                  icon: Icons.hub_outlined,
                  lines: const [
                    'RelayHub Mobile 1.0.0',
                    '移动端不会保存 API 密钥明文',
                    '设备命令通过加密队列传递',
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.logout),
            label: const Text('退出登录'),
          ),
        ),
      ],
    ),
  );
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.tooltip,
    required this.onPressed,
    required this.child,
  });

  final String tooltip;
  final VoidCallback? onPressed;
  final Widget child;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 48,
    height: 48,
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: RelayColors.surface,
        border: Border.all(color: RelayColors.line),
        borderRadius: BorderRadius.circular(6),
      ),
      child: IconButton(tooltip: tooltip, onPressed: onPressed, icon: child),
    ),
  );
}

class _IconTile extends StatelessWidget {
  const _IconTile({
    required this.icon,
    this.foreground = RelayColors.blue,
    this.background = RelayColors.blueSoft,
  });

  final IconData icon;
  final Color foreground;
  final Color background;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(6),
    ),
    alignment: Alignment.center,
    child: Icon(icon, color: foreground, size: 21),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.labelSmall?.copyWith(color: RelayColors.muted),
      ),
      const SizedBox(height: 3),
      Text(
        value,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
      ),
    ],
  );
}

class _SyncPanel extends StatelessWidget {
  const _SyncPanel({
    required this.online,
    required this.lastSyncedLabel,
    required this.onKeys,
  });

  final bool online;
  final String lastSyncedLabel;
  final VoidCallback onKeys;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          _IconTile(
            icon: online ? Icons.sync_rounded : Icons.sync_disabled_rounded,
            foreground: online ? RelayColors.blue : RelayColors.muted,
            background: online
                ? RelayColors.blueSoft
                : RelayColors.surfaceMuted,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  online ? '数据已同步' : '等待设备同步',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  lastSyncedLabel,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
                ),
              ],
            ),
          ),
          TextButton(onPressed: onKeys, child: const Text('查看')),
        ],
      ),
    ),
  );
}

class _AccountPanel extends StatelessWidget {
  const _AccountPanel({
    required this.name,
    required this.email,
    required this.onTap,
  });

  final String name;
  final String email;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    color: RelayColors.dark,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(6)),
      side: BorderSide(color: RelayColors.dark),
    ),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: RelayColors.blue,
                borderRadius: BorderRadius.circular(6),
              ),
              alignment: Alignment.center,
              child: Text(
                name.substring(0, 1).toUpperCase(),
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: Theme.of(
                      context,
                    ).textTheme.titleMedium?.copyWith(color: Colors.white),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: Colors.white70),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_outward_rounded, color: Colors.white70),
          ],
        ),
      ),
    ),
  );
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({required this.device, required this.onTap});

  final DeviceSnapshot device;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _IconTile(
                  icon: device.online
                      ? Icons.desktop_windows_outlined
                      : Icons.desktop_access_disabled_outlined,
                  foreground: device.online
                      ? RelayColors.blue
                      : RelayColors.muted,
                  background: device.online
                      ? RelayColors.blueSoft
                      : RelayColors.surfaceMuted,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    device.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: RelayColors.faint,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(height: 1, color: RelayColors.line),
            const SizedBox(height: 12),
            Row(
              children: [
                _DeviceStatus(online: device.online),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${_routingLabel(device.routingMode)} · ${device.lastSyncedLabel}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class _DeviceStatus extends StatelessWidget {
  const _DeviceStatus({required this.online});

  final bool online;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: online ? RelayColors.blueSoft : RelayColors.surfaceMuted,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      online ? '在线' : '离线',
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
        color: online ? RelayColors.bluePressed : RelayColors.muted,
      ),
    ),
  );
}

class _OperationPanel extends StatelessWidget {
  const _OperationPanel({required this.operations});

  final List<OperationRecord> operations;

  @override
  Widget build(BuildContext context) => Card(
    child: Column(
      children: [
        for (var index = 0; index < operations.length; index++) ...[
          _OperationRow(record: operations[index]),
          if (index != operations.length - 1) const Divider(),
        ],
      ],
    ),
  );
}

class _OperationRow extends StatelessWidget {
  const _OperationRow({required this.record});

  final OperationRecord record;

  @override
  Widget build(BuildContext context) {
    final successful = record.state == CommandState.succeeded;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _IconTile(
            icon: successful
                ? Icons.check_rounded
                : Icons.error_outline_rounded,
            foreground: successful ? RelayColors.blue : RelayColors.danger,
            background: successful
                ? RelayColors.blueSoft
                : const Color(0xFFFFEDEA),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  record.title,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  record.detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            record.time,
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: RelayColors.faint),
          ),
        ],
      ),
    );
  }
}

class _SwitchSettingRow extends StatelessWidget {
  const _SwitchSettingRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => SwitchListTile.adaptive(
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    secondary: _IconTile(
      icon: icon,
      foreground: RelayColors.ink,
      background: RelayColors.surfaceMuted,
    ),
    title: Text(title, style: Theme.of(context).textTheme.titleSmall),
    subtitle: Text(
      subtitle,
      style: Theme.of(
        context,
      ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
    ),
    value: value,
    onChanged: onChanged,
  );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          _IconTile(
            icon: icon,
            foreground: RelayColors.ink,
            background: RelayColors.surfaceMuted,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const Icon(Icons.chevron_right_rounded, color: RelayColors.faint),
        ],
      ),
    ),
  );
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.width,
    required this.icon,
    required this.label,
    required this.value,
    required this.detail,
    this.onTap,
  });
  final double width;
  final IconData icon;
  final String label;
  final String value;
  final String detail;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Semantics(
    button: onTap != null,
    label: '$label，$value，$detail',
    child: SizedBox(
      width: width,
      child: Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 168),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _IconTile(icon: icon),
                      const Spacer(),
                      if (onTap != null)
                        const Icon(
                          Icons.arrow_outward_rounded,
                          size: 18,
                          color: RelayColors.faint,
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Text(
                    label,
                    style: Theme.of(
                      context,
                    ).textTheme.labelMedium?.copyWith(color: RelayColors.muted),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    value,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    detail,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _ActiveKeyBanner extends StatelessWidget {
  const _ActiveKeyBanner({required this.relayKey, required this.mode});
  final RelayKey relayKey;
  final RoutingMode mode;
  @override
  Widget build(BuildContext context) => Card(
    color: RelayColors.dark,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(6)),
      side: BorderSide(color: RelayColors.dark),
    ),
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: RelayColors.blue,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'ACTIVE ROUTE',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Colors.white70,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: RelayColors.blue,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  _routingLabel(mode),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            relayKey.name,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '${relayKey.station} · ${relayKey.maskedValue}',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: Colors.white70),
          ),
        ],
      ),
    ),
  );
}

class _KeyCard extends StatelessWidget {
  const _KeyCard({
    required this.relayKey,
    required this.online,
    required this.loading,
    required this.onActivate,
    required this.groups,
    required this.onChangeGroup,
  });
  final RelayKey relayKey;
  final bool online;
  final bool loading;
  final VoidCallback onActivate;
  final List<RelayGroup> groups;
  final ValueChanged<String> onChangeGroup;
  @override
  Widget build(BuildContext context) {
    final active = relayKey.health == KeyHealth.active;
    final currentGroup = groups
        .where((group) => group.name == relayKey.group)
        .firstOrNull;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(6)),
        side: BorderSide(
          color: active ? RelayColors.blue : RelayColors.line,
          width: active ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _IconTile(
                  icon: Icons.key_outlined,
                  foreground: active ? Colors.white : RelayColors.blue,
                  background: active ? RelayColors.blue : RelayColors.blueSoft,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        relayKey.name,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${relayKey.station} · ${relayKey.maskedValue}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: RelayColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                _StatusPill(health: relayKey.health),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: _Metric(label: '余额 / 额度', value: relayKey.balance),
                ),
                Container(width: 1, height: 42, color: RelayColors.line),
                const SizedBox(width: 16),
                Expanded(
                  child: _Metric(
                    label: '有效期',
                    value: relayKey.expiresLabel ?? '未提供',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              decoration: BoxDecoration(
                color: RelayColors.surfaceMuted,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.account_tree_outlined,
                    size: 20,
                    color: RelayColors.ink,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '当前分组',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: RelayColors.muted),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${relayKey.group} · x${(currentGroup?.multiplier ?? 1).toStringAsFixed(2)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  TextButton.icon(
                    onPressed: loading || groups.isEmpty
                        ? null
                        : () async {
                            final group = await _selectGroup(
                              context,
                              current: relayKey.group,
                              groups: groups,
                            );
                            if (group != null) onChangeGroup(group.name);
                          },
                    icon: const Icon(Icons.swap_horiz_rounded, size: 18),
                    label: const Text('换组'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: active
                      ? OutlinedButton.icon(
                          onPressed: null,
                          icon: const Icon(Icons.check_rounded),
                          label: const Text('当前启用'),
                        )
                      : FilledButton.icon(
                          onPressed: online && relayKey.canActivate && !loading
                              ? onActivate
                              : null,
                          icon: loading
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.power_settings_new_rounded),
                          label: Text(
                            loading
                                ? '切换中'
                                : online
                                ? '启用密钥'
                                : '设备离线',
                          ),
                        ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.health});
  final KeyHealth health;
  @override
  Widget build(BuildContext context) {
    final text = switch (health) {
      KeyHealth.active => '已启用',
      KeyHealth.available => '可用',
      KeyHealth.disabled => '已停用',
      KeyHealth.expired => '已过期',
      KeyHealth.depleted => '额度不足',
    };
    final exceptional =
        health == KeyHealth.expired ||
        health == KeyHealth.depleted ||
        health == KeyHealth.disabled;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: health == KeyHealth.active
            ? RelayColors.blueSoft
            : exceptional
            ? const Color(0xFFFFEDEA)
            : RelayColors.surfaceMuted,
        border: Border.all(
          color: health == KeyHealth.active
              ? RelayColors.blue
              : exceptional
              ? const Color(0xFFFECACA)
              : RelayColors.line,
        ),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          color: health == KeyHealth.active
              ? RelayColors.bluePressed
              : exceptional
              ? RelayColors.danger
              : RelayColors.muted,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: selected ? RelayColors.dark : RelayColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6),
          side: BorderSide(
            color: selected ? RelayColors.dark : RelayColors.line,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: selected ? Colors.white : RelayColors.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.meta});
  final String title;
  final String? meta;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
      ),
      if (meta != null)
        Text(
          meta!,
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(color: RelayColors.muted),
        ),
    ],
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
      child: Column(
        children: [
          const _IconTile(
            icon: Icons.key_off_outlined,
            foreground: RelayColors.muted,
            background: RelayColors.surfaceMuted,
          ),
          const SizedBox(height: 12),
          Text('没有符合条件的密钥', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(
            '调整搜索词或筛选条件后重试',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
          ),
        ],
      ),
    ),
  );
}

class _RestartSheet extends StatelessWidget {
  const _RestartSheet({required this.relayKey});
  final RelayKey relayKey;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _IconTile(
          icon: Icons.restart_alt_rounded,
          foreground: Colors.white,
          background: RelayColors.dark,
        ),
        const SizedBox(height: 16),
        Text(
          '确认启用新密钥？',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        Text(
          '直连模式将应用 ${relayKey.name}，并自动重启 Codex Desktop。正在进行的会话可能中断。',
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: RelayColors.muted),
        ),
        const SizedBox(height: 24),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('取消'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('确认并重启'),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

Future<RelayGroup?> _selectGroup(
  BuildContext context, {
  required String current,
  required List<RelayGroup> groups,
}) => showModalBottomSheet<RelayGroup>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (context) => SafeArea(
    top: false,
    child: ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .78,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '选择密钥分组',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                '切换后将同步到当前站点',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
              ),
              const SizedBox(height: 16),
              RadioGroup<RelayGroup>(
                groupValue: groups
                    .where((item) => item.name == current)
                    .firstOrNull,
                onChanged: (value) {
                  if (value != null) Navigator.pop(context, value);
                },
                child: Column(
                  children: groups
                      .map(
                        (group) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: RadioListTile<RelayGroup>(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                            ),
                            tileColor: RelayColors.surfaceMuted,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(6),
                              side: BorderSide(
                                color: group.name == current
                                    ? RelayColors.blue
                                    : RelayColors.line,
                              ),
                            ),
                            activeColor: RelayColors.dark,
                            title: Text(
                              group.name,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            subtitle: Text(
                              '倍率 x${group.multiplier.toStringAsFixed(2)}',
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: RelayColors.muted),
                            ),
                            value: group,
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  ),
);

void _deviceSheet(BuildContext context, DeviceSnapshot device) {
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _IconTile(
            icon: device.online
                ? Icons.desktop_windows_outlined
                : Icons.desktop_access_disabled_outlined,
            foreground: device.online ? RelayColors.blue : RelayColors.muted,
            background: device.online
                ? RelayColors.blueSoft
                : RelayColors.surfaceMuted,
          ),
          const SizedBox(height: 16),
          Text(
            device.name,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 20),
          _DeviceDetail(label: '设备状态', value: device.online ? '在线' : '离线'),
          _DeviceDetail(
            label: 'Codex Desktop',
            value: device.codexRunning ? '正在运行' : '未运行',
          ),
          _DeviceDetail(
            label: '中转模式',
            value: _routingLabel(device.routingMode),
          ),
          _DeviceDetail(label: '最后同步', value: device.lastSyncedLabel),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close_rounded),
              label: const Text('关闭'),
            ),
          ),
        ],
      ),
    ),
  );
}

class _DeviceDetail extends StatelessWidget {
  const _DeviceDetail({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        SizedBox(
          width: 92,
          child: Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: RelayColors.muted),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}

void _infoSheet(
  BuildContext context, {
  required String title,
  required IconData icon,
  required List<String> lines,
}) {
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _IconTile(
            icon: icon,
            foreground: Colors.white,
            background: RelayColors.dark,
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 14),
          ...lines.map(
            (line) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                line,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: RelayColors.muted),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('关闭'),
            ),
          ),
        ],
      ),
    ),
  );
}

String _routingLabel(RoutingMode mode) =>
    mode == RoutingMode.localGateway ? '本地网关' : '直连模式';
