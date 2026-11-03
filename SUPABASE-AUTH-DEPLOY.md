# 共享登录升级与后台切换步骤

状态：这是待部署的分支方案，不代表线上数据已经安全。未访问患者云端行数据，未更改 Supabase 后台。主分支保持原样。

## 已核对的源码配置

- 项目：`ocunhxbioecspvlblpvl.supabase.co`；浏览器使用的是 `sb_publishable_` 公钥，不是 service role。
- `public.patients(id,data)`：每名患者一条 JSON 记录；`public.roster(id,data)`：名单使用 id=1 的 JSON 数组；`public.gallery(id,data)`：照片元数据。
- Storage 桶 `gallery`，文件路径 `photos/<id>.<扩展名>`。旧版用 public URL，新版只持久化 path，兼容从该项目旧 public URL 提取路径，通过有效期 5 分钟的 signed URL 显示。
- 上述是源码依赖，不是后台实测结果。实际类型、RLS、授权、桶公开状态必须通过 preflight SQL 核对；仓库未包含数据库迁移或管理端凭证。

## 已实现

使用 Supabase Auth 的邮箱密码登录、服务端 getUser 验证、只接受已验证邮箱 `2079700358@qq.com`。默认记住会话；取消勾选时使用 sessionStorage，关闭标签页后不保留；记住时仅保存 Auth 会话 token。浏览器可能恢复关闭标签页的 sessionStorage，因此公共设备仍应主动退出。密码不写入文件、存储或日志。

启动时隐藏管理界面，验证并成功读取三张表后才显示；无本地离线绕过。会话失效/退出立即锁屏并清除敏感内存和显示内容；退出后刷新以丢弃异步读文件、计时器和隐藏界面。退出只针对当前设备，其他设备会话仍有效。网络断开时无法保证远端撤销成功，短期 access token 在到期前仍可能有效。

不再将患者、名单、照片缓存到 localStorage；部署首次启动会删除三个旧缓存键。**先导出并核对旧浏览器中尚未同步的资料，再打开新版**。这份改动保留云端既有记录；未制作真实患者数据备份。云端读写会检查 Supabase 返回 error，失败不报告成功；照片上传失败不会保存失效 public URL。补充动态表格与名单的 HTML 转义。

## 用户需在 Supabase 后台完成（不要把密码发给开发者）

1. 在维护窗口中，先从可信管理员设备导出并离线保存数据库备份、Storage 原始文件及当前策略/授权配置。原网页“备份”中的照片 URL 不是照片原始文件备份。导出旧浏览器尚未同步的数据。不要把健康数据备份提交 GitHub。
2. SQL Editor 运行 `supabase-auth-preflight.sql`。确认三张表存在 id 与 JSON/JSONB data 列；名单确实为 id=1。查看所有现有策略、公开桶状态、API 暴露的视图/函数。另行检查其他表、RPC、视图、其他桶是否复制或绕过保护；本 SQL 只覆盖明确识别的资源。发现不符先停止，不创建假表覆盖数据。
3. Authentication → Providers 启用 Email/Password。Authentication → Users 创建或确认邮箱为 `2079700358@qq.com` 的用户，并确认邮箱。由你自行安全设置强密码或使用后台邀请/重置流程。关闭公开新用户注册；无需为此页面开启匿名登录。不要使用网站自行注册来证明共享用户权限。
4. SQL Editor 以项目管理员身份运行 `supabase-auth-rls.sql`。脚本从 auth.users 获取唯一已验证用户 UUID，以 UUID 做真正授权，不依赖前端邮箱判断或可自行修改的 user_metadata。事务中启用三表 RLS、撤销 anon/public 表授权、允许共享 UUID 的 CRUD，并添加 restrictive guard，防止已有宽松策略继续放行；同时将 gallery 桶设为 private，并约束该桶所有对象只能由共享 UUID 访问 photos/ 路径。其他桶既有策略不改。旧 restrictive 策略若拒绝共享用户，需要管理员检查后调整；不会自动删除它们。
5. 如 Gallery 使用 photos/ 之外路径，先核对并调整限制。Storage 中孤立文件可另行清理，不在本次自动删除。旧元数据 URL 可保持原样，新版会提取路径。符合图片格式的旧嵌入 dataUrl 会保留在受 RLS 保护的表中，后续建议迁移到 private Storage。
6. Auth URL Configuration 的 Site URL 设为 `https://xyy33xyy-hue.github.io/scoliosis/`。如后台邀请/重置需要回跳，应使用你可控制、已实现对应恢复流程的页面；本页只支持密码登录，不消费恢复链接、不实现设置新密码流程，不把恢复回跳随意指到本页。
7. 按下面验收完毕后，再合并 PR 发布。RLS 一旦启用，旧版匿名页面会停止读写；维护期是预期影响。仓库还有 `scoliosis-screening.html`、`-1/-6/-7/-8/-9.html` 等旧页，应停用入口或后续升级，不能为了旧页恢复 anon 放行。

## 必须进行的后台与真实账号验收

- 使用公钥且没有用户 JWT：三表 SELECT/INSERT/UPDATE/DELETE 均不得访问患者；测试写入使用测试事务或隔离测试项目，禁止修改真实患者。读取为无权限错误或 RLS 下空结果均可，不应返回真实行。
- 使用另一个已注册用户 JWT（不只是没有登录）：同样不得访问三表及 gallery 对象。只检查“authenticated”不足以满足共享账号限制。
- 共享账号登录后核对原记录、名单、照片；新建专用测试记录，确认保存刷新后仍在，再删除测试记录。确认下载、上传和删除专用测试图片正常。
- 取一个既有 public 照片 URL，在未登录窗口直接打开应失败。未登录下载/列举/上传同样应失败；共享用户签发的临时链接可以在期限内被持有者访问，到期后应失效。临时链接不要公开转发，已下载的副本无法收回。旧公开链接可能已有 CDN/浏览器缓存，需按 Supabase 实际缓存配置处理或联系支持清除，必要时迁移敏感对象路径并检查旧路径失效。
- 测试密码错误、离线、三表任一读写拒绝、共享账号以外用户、刷新恢复会话、取消记住、退出、另一标签页退出、会话到期。退出后返回/刷新不得出现患者资料。新标签页独立 sessionStorage，复制标签页及浏览器会话恢复行为请在目标设备实测。
- 启用后重新跑 preflight，确认 private 桶、RLS 和 restrictive guard 确实生效。不要仅凭前端锁屏判断数据安全。

## 验证范围与局限

本地已做浏览器模拟 Supabase 的行为验证及 JavaScript 语法检查；测试不请求真实患者数据、不使用真实密码。真实 Auth 登录、SQL 执行和线上 RLS/Storage 验收需要你的后台权限，尚未完成。SQL 未在真实数据库执行。

shared 模式维持共享数据，不按患者 owner_id 隔离；同一账号多人使用无法区分个人审计责任。原系统名单/照片排序/批量导入仍采用 JSON 整体写回，并发编辑可能覆盖他人变更，建议避免同时编辑同一名单或批量资料，后续可另作版本冲突控制。

## 备份与回退

- 原仓库完整 Git 状态：`backup/pre-auth-20261103` 分支，固定起点 `8720c16955214af135c061565eee957386d539d7`。
- 本次只提交新分支，不合并、不直接发布，也不运行后台 SQL。
- 前端可回退到备份文件，但保留安全 RLS 后旧页面无法匿名访问，这是预期。不要为回退 UI 将桶重新公开或移除访问保护。后台回退需管理员使用事前导出的配置制定方案；优先修复新版或维护停机。

参考：[Supabase 数据安全](https://supabase.com/docs/guides/database/secure-data)、[getUser](https://supabase.com/docs/reference/javascript/auth-getuser)、[私有 Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals)。
