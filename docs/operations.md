# 运维与发布检查清单

## 数据库

- 在应用内调用 `backup_database` 导出 SQLite 备份；命令会执行检查点并验证副本能打开。
- 恢复前必须退出桌面应用，再运行 `scripts/restore-database.ps1`。脚本会先保存当前数据库的时间戳副本。
- 发布前在副本上验证旧版数据库可由新版本打开；现有迁移测试覆盖远程服务器历史表字段迁移。

## 真实接口回归

- GitHub Actions 的 `real-station-e2e` 只能手动触发，并使用 `production-e2e` Environment 的 Secrets。
- 必填 Secrets：`RELAYHUB_E2E_SUB2_EMAIL`、`RELAYHUB_E2E_SUB2_PASSWORD`、`RELAYHUB_E2E_NEWAPI_USERNAME`、`RELAYHUB_E2E_NEWAPI_PASSWORD`。
- 测试创建临时密钥，并始终在 `finally` 清理。请使用专用低权限测试账户，禁止写入生产账号或仓库文件。

## 发布前的外部配置

- 代码签名：配置 Azure Trusted Signing 或企业 EV/OV 证书，不要将私钥存入仓库或 CI 日志。
- 崩溃监控：选择并配置 Sentry 等平台的 DSN；启用前确认隐私策略、用户告知与 PII 脱敏。
- 发布与回滚：每个版本保留上一个安装包、校验和与变更日志；灰度验证通过后再设为正式版本。出现严重问题时回退到上一个签名版本。
