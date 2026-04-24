# Server Inventory (Redacted)

- Checked at: `2026-04-22T10:52:03.773Z`
- Inventory root: `D:\code\免密服务器\数字海洋`
- Servers detected: `2`
- Sensitive files detected: `true`
- Current local SSH config has DO aliases: `false`

## Servers

### california
- droplet_name: `do-mini-sfo3-01`
- region: `california`
- role: `primary_factory_server`
- ip_redacted: `134.199.xxx.xxx`
- ssh_user: `root`
- ssh_key_path_redacted: `C:\Users\<redacted>\.ssh\id_ed25519_do_auto`
- ssh_config_detected: `true`
- current_local_alias_present: `false`
- login_method: `direct_ip_with_private_key`
- recommended_role: `primary_factory_server`
- should_connect_now: `false`
- sensitive_files_detected: `true`
- notes_files_detected:
  - `阿里云 OSS 备份/备份流程总览-2026-04-22.md`
  - `阿里云 OSS 备份/第一台DO服务器接入记录-2026-04-22.md`
  - `阿里云 OSS 备份/Bucket-接入建议-2026-04-22.md`
  - `阿里云 OSS 备份/OSS到极空间第二副本-2026-04-22.md`
  - `阿里云 OSS 备份/README.md`
  - `创建结果-2026-04-21.md`
  - `对话摘录.md`
  - `会话记录.md`
  - `极空间 SFTP 备份/极空间-Docker-备份目标方案-2026-04-22.md`
  - `极空间 SFTP 备份/极空间-SFTPGo-部署记录-2026-04-22.md`
  - `极空间-Docker-备份目标方案-2026-04-22.md`
  - `极空间-SFTPGo-部署记录-2026-04-22.md`
  - `新电脑迁移包/05_新电脑迁移-导入DO配置.ps1`
  - `新电脑迁移包/新电脑迁移步骤-2026-04-22.md`
  - `新电脑迁移包/SSH-config-DO片段.txt`
  - `droplets.current.json`
  - `FinalShell-连接与备份建议-2026-04-22.md`
  - `state/create-droplets-response.json`
  - `Supabase-部署与测速-2026-04-21.md`
- blockers:
  - Current ~/.ssh/config does not yet include the droplet alias. Import the SSH config fragment or use explicit -i login.
  - Inventory-only phase. SSH doctor requires explicit user approval before any connection attempt.

### singapore
- droplet_name: `do-mini-sgp1-01`
- region: `singapore`
- role: `backup_or_staging`
- ip_redacted: `188.166.xxx.xxx`
- ssh_user: `root`
- ssh_key_path_redacted: `C:\Users\<redacted>\.ssh\id_ed25519_do_auto`
- ssh_config_detected: `true`
- current_local_alias_present: `false`
- login_method: `direct_ip_with_private_key`
- recommended_role: `backup_or_staging`
- should_connect_now: `false`
- sensitive_files_detected: `true`
- notes_files_detected:
  - `阿里云 OSS 备份/备份流程总览-2026-04-22.md`
  - `阿里云 OSS 备份/第二台DO服务器接入记录-2026-04-22.md`
  - `阿里云 OSS 备份/Bucket-接入建议-2026-04-22.md`
  - `阿里云 OSS 备份/OSS到极空间第二副本-2026-04-22.md`
  - `阿里云 OSS 备份/README.md`
  - `创建结果-2026-04-21.md`
  - `对话摘录.md`
  - `会话记录.md`
  - `极空间 SFTP 备份/极空间-Docker-备份目标方案-2026-04-22.md`
  - `极空间-Docker-备份目标方案-2026-04-22.md`
  - `新电脑迁移包/05_新电脑迁移-导入DO配置.ps1`
  - `新电脑迁移包/新电脑迁移步骤-2026-04-22.md`
  - `新电脑迁移包/SSH-config-DO片段.txt`
  - `droplets.current.json`
  - `FinalShell-连接与备份建议-2026-04-22.md`
  - `state/create-droplets-response.json`
  - `Supabase-部署与测速-2026-04-21.md`
- blockers:
  - Current ~/.ssh/config does not yet include the droplet alias. Import the SSH config fragment or use explicit -i login.
  - Inventory-only phase. SSH doctor requires explicit user approval before any connection attempt.

## Sensitive Material Handling

- Private key contents were not read.
- Secret tokens were not printed.
- Inventory output keeps IPs and key paths redacted.
