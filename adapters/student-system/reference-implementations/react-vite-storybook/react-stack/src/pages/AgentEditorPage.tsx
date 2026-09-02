import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardBody, CardHeader, Button, Input, Select, SelectItem } from '@heroui/react'
import { ArrowLeft, Save } from 'lucide-react'

export default function AgentEditorPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    client: 'claude-code',
    command: 'claude',
    model: 'sonnet',
    deployment: 'local',
    localKind: 'client',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    navigate('/models')
  }

  return (
    <div className="space-y-6">
      <Button variant="flat" size="sm" onPress={() => navigate('/models')}>
        <ArrowLeft size={16} />
        返回列表
      </Button>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">添加 Agent 配置</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <Input
              label="名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              isRequired
            />
            <Select
              label="客户端类型"
              selectedKeys={[form.client]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string
                const defaults: Record<string, { command: string; model: string }> = {
                  'claude-code': { command: 'claude', model: 'glm-5' },
                  opencode: { command: 'opencode', model: '' },
                  codex: { command: 'codex', model: '' },
                  custom: { command: '', model: '' },
                }
                const next = defaults[val] || { command: form.command, model: form.model }
                setForm({ ...form, client: val, command: next.command, model: next.model })
              }}
            >
              <SelectItem key="claude-code">Claude Code</SelectItem>
              <SelectItem key="opencode">OpenCode</SelectItem>
              <SelectItem key="codex">Codex</SelectItem>
              <SelectItem key="custom">自定义</SelectItem>
            </Select>
            <Input
              label="命令"
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="claude"
            />
            <Input
              label="默认模型"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="sonnet"
            />
            <Select
              label="部署方式"
              selectedKeys={[form.deployment]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string
                setForm({ ...form, deployment: val })
              }}
            >
              <SelectItem key="local">本地</SelectItem>
              <SelectItem key="remote">远程</SelectItem>
            </Select>
            <Button type="submit" color="primary" className="w-full">
              <Save size={16} />
              保存配置
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
