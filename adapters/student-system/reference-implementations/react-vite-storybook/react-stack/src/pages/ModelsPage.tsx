import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Button, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react'
import { Plus, Settings, Trash2, TestTube } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function ModelsPage() {
  const { appState, refreshState } = useAppState()
  const navigate = useNavigate()

  const providers = appState?.modelManagement?.providers || []
  const agents = appState?.modelManagement?.agents || []

  async function handleDelete(id: string) {
    if (!confirm('确定要删除此模型配置吗？')) return
    await fetch(`/api/models/${id}`, { method: 'DELETE' })
    await refreshState()
  }

  async function handleToggleActive(id: string, active: boolean) {
    await fetch(`/api/models/${id}/${active ? 'deactivate' : 'activate'}`, {
      method: 'POST',
    })
    await refreshState()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">模型配置</h2>
          <Button color="primary" size="sm" onPress={() => navigate('/model-editor')}>
            <Plus size={16} />
            添加模型
          </Button>
        </CardHeader>
        <CardBody>
          {providers.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无模型配置。点击上方按钮添加。
            </p>
          ) : (
            <Table aria-label="模型列表">
              <TableHeader>
                <TableColumn>名称</TableColumn>
                <TableColumn>应用</TableColumn>
                <TableColumn>主模型</TableColumn>
                <TableColumn>图片模型</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn>操作</TableColumn>
              </TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.applications?.map((app) => (
                          <Chip key={app} size="sm" variant="flat">
                            {app}
                          </Chip>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{p.models?.primary}</TableCell>
                    <TableCell>{p.models?.image || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        color={p.active ? 'success' : 'default'}
                        variant="flat"
                        size="sm"
                      >
                        {p.active ? '已激活' : '未激活'}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => handleToggleActive(p.id, p.active)}
                        >
                          {p.active ? '停用' : '激活'}
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => handleDelete(p.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Agent 配置</h2>
          <Button color="primary" size="sm" onPress={() => navigate('/agent-editor')}>
            <Plus size={16} />
            添加 Agent
          </Button>
        </CardHeader>
        <CardBody>
          {agents.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无 Agent 配置。
            </p>
          ) : (
            <Table aria-label="Agent 列表">
              <TableHeader>
                <TableColumn>名称</TableColumn>
                <TableColumn>客户端</TableColumn>
                <TableColumn>模型</TableColumn>
                <TableColumn>状态</TableColumn>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{a.client}</TableCell>
                    <TableCell>{a.model}</TableCell>
                    <TableCell>
                      <Chip
                        color={a.active ? 'success' : 'default'}
                        variant="flat"
                        size="sm"
                      >
                        {a.active ? '已激活' : '未激活'}
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
