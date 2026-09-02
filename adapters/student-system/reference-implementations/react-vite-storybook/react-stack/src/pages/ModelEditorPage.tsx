import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardBody, CardHeader, Button, Input, Textarea, Chip, Checkbox } from '@heroui/react'
import { ArrowLeft, Save } from 'lucide-react'

export default function ModelEditorPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    endpoint: '',
    apiKey: '',
    models: { primary: '', fast: '', balanced: '', advanced: '', image: '', custom: '' },
    applications: [] as string[],
    notes: '',
    websiteUrl: '',
    latency: 120,
  })

  const appOptions = ['学习分析', 'OCR识别', '练习生成']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/models', {
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
          <h2 className="text-xl font-semibold">添加模型配置</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <Input
              label="名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              isRequired
            />
            <Input
              label="API Endpoint"
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://api.example.com/v1"
              isRequired
            />
            <Input
              label="API Key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              isRequired
            />
            <Input
              label="主模型"
              value={form.models.primary}
              onChange={(e) =>
                setForm({
                  ...form,
                  models: { ...form.models, primary: e.target.value },
                })
              }
              isRequired
            />
            <Input
              label="图片模型"
              value={form.models.image}
              onChange={(e) =>
                setForm({
                  ...form,
                  models: { ...form.models, image: e.target.value },
                })
              }
              placeholder="gpt-image-2 / gpt-image-1"
            />
            <div>
              <p className="text-sm font-medium mb-2">支持应用</p>
              <div className="flex flex-wrap gap-2">
                {appOptions.map((app) => (
                  <Checkbox
                    key={app}
                    isSelected={form.applications.includes(app)}
                    onValueChange={(checked) => {
                      if (checked) {
                        setForm({ ...form, applications: [...form.applications, app] })
                      } else {
                        setForm({
                          ...form,
                          applications: form.applications.filter((a) => a !== app),
                        })
                      }
                    }}
                  >
                    {app}
                  </Checkbox>
                ))}
              </div>
            </div>
            <Textarea
              label="备注"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
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
