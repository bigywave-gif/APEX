import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Progress, Chip } from '@heroui/react'
import { BookOpen, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react'

function uploadDisplayTitle(upload: { displayTitle?: string; title?: string; uploadType?: string }) {
  return upload.displayTitle || upload.title || upload.uploadType || '学习材料'
}

export default function HomePage() {
  const { appState } = useAppState()
  const uploads = appState?.uploads || []
  const practices = appState?.practices || []
  const mistakes = appState?.mistakes || []
  const weaknesses = appState?.weaknesses || []

  const completedPractices = practices.filter((p) => p.status === '已完成').length
  const totalQuestions = appState?.questions?.length || 0
  const weakCount = weaknesses.filter((w) => w.status === '薄弱').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-blue-50 rounded-xl">
              <BookOpen className="text-blue-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{uploads.length}</p>
              <p className="text-sm text-slate-500">已诊断材料</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-green-50 rounded-xl">
              <CheckCircle className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedPractices}</p>
              <p className="text-sm text-slate-500">已完成练习</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-amber-50 rounded-xl">
              <AlertTriangle className="text-amber-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{mistakes.length}</p>
              <p className="text-sm text-slate-500">历史错题</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-purple-50 rounded-xl">
              <TrendingUp className="text-purple-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalQuestions}</p>
              <p className="text-sm text-slate-500">题目记录</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {weakCount > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <h3 className="text-lg font-semibold text-amber-800">
              需要关注：{weakCount} 个薄弱知识点
            </h3>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {weaknesses
                .filter((w) => w.status === '薄弱')
                .slice(0, 8)
                .map((w) => (
                  <Chip key={w.id} color="warning" variant="flat" size="sm">
                    {w.knowledge}
                  </Chip>
                ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">最近诊断</h3>
        </CardHeader>
        <CardBody>
          {uploads.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无诊断记录。请先在“作业诊断”页面上传学习材料。
            </p>
          ) : (
            <div className="space-y-3">
              {uploads.slice(0, 5).map((upload) => (
                <div
                  key={upload.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{uploadDisplayTitle(upload)}</p>
                    <p className="text-sm text-slate-500">
                      {upload.subject} · {upload.gradeTerm} · {upload.uploadType}
                    </p>
                  </div>
                  <Chip size="sm" variant="flat">
                    {(upload.contentAnalysis?.questions?.length || 0)} 题
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
