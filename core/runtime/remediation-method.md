# APEX 标准化修复方法

APEX 对流程、调用、依赖、证据、输出、性能、兼容性或安全风险的修复，不得先凭经验叠加新步骤、确认或 AI 判断链。每个修复均按以下顺序进行：

1. 定位风险域及可观察的失败条件；
2. 查找适用的权威标准、官方文档或成熟开源实现，明确其适用边界；
3. 映射到现有 Router、Gate、工件和可控脚本，不另起平行流程；
4. 采用最小可验证改动，评估阶段耗时、Token、稳定性、性能与复杂度；
5. 区分原始证据、机器结论和 AI 解释；原始证据不足时只允许标记 `unverified`；
6. 用正向真实证据与反向失败样例验证；不得以模板、手填结论或旧版本工件冒充实证；
7. 把确认保留在既定 Gate：不得新增无实质决策的用户确认，也不得跳过既定 Gate。

本方法参考 NIST SSDF 对可验证安全开发活动的要求、OWASP ASVS 的验证思想，以及 OWASP AISVS 对 AI 系统可追溯和可验证控制的要求。它是 APEX 的工程方法，不表示获得任何标准认证。

参考：<https://csrc.nist.gov/projects/ssdf>、<https://owasp.org/www-project-application-security-verification-standard/>、<https://owasp.org/www-project-artificial-intelligence-security-verification-standard-aisvs-docs/>。
