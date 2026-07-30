import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayhub_mobile/main.dart';

void main() {
  testWidgets('shows the four operational dashboard cards', (tester) async {
    await tester.pumpWidget(const RelayHubMobileApp());
    await tester.pumpAndSettle();
    expect(find.text('设备状态'), findsOneWidget);
    expect(find.text('当前启用'), findsOneWidget);
    expect(find.text('可用余额'), findsOneWidget);
    expect(find.text('今日消耗'), findsOneWidget);
  });

  testWidgets('switches to keys and activates an available key', (
    tester,
  ) async {
    await tester.pumpWidget(const RelayHubMobileApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('API 密钥'));
    await tester.pumpAndSettle();
    expect(find.text('Atlas · 主力'), findsWidgets);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -650));
    await tester.pumpAndSettle();
    final activationButton = find.widgetWithText(FilledButton, '启用密钥').first;
    await tester.tap(activationButton);
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsOneWidget);
  });

  testWidgets('shows group names and multipliers in the group selector', (
    tester,
  ) async {
    await tester.pumpWidget(const RelayHubMobileApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('API 密钥'));
    await tester.pumpAndSettle();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -300));
    await tester.pumpAndSettle();
    final changeGroup = find.text('换组').first;
    await tester.tap(changeGroup);
    await tester.pumpAndSettle();

    expect(find.text('选择密钥分组'), findsOneWidget);
    expect(find.text('default'), findsWidgets);
    expect(find.text('倍率 x1.00'), findsOneWidget);
  });
}
