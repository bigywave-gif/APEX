import { useState } from 'react'
import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Button, Chip, Progress, Textarea } from '@heroui/react'
import { Upload, FileText, Trash2 } from 'lucide-react'

function uploadDisplayTitle(upload: { displayTitle?: string; title?: string; uploadType?: string }) {
  return upload.displayTitle || upload.title || upload.uploadType || '学习材料'
}

export default function UploadPage() {
  const { appState, refreshState } = useAppState()
  const [files, setFiles] = useState<File[]>([])
  const [uploadType, setUploadType] = useState('学校试卷')
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploads = appState?.uploads || []

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) return

    setIsUploading(true)
    setProgress(10)

    // TODO: Implement file reading and upload logic
    // For now, simulate the upload
    setProgress(50)
    await new Promise((r) => setTimeout(r, 1000))
    setProgress(100)

    await refreshState()
    setIsUploading(false)
    setFiles([])
    setProgress(0)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">上传学习材料</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">内容类型</label>
              <select
                className="w-full p-2 border rounded-lg"
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
              >
                <option>学校试卷</option>
                <option>日常作业</option>
                <option>假期作业</option>
                <option>专项练习</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">选择文件</label>
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors">
                <Upload className="mx-auto mb-3 text-slate-400" size={32} />
                <p className="text-sm text-slate-500 mb-2">
                  拖拽文件到此处，或点击选择
                </p>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="hidden"
                  id="file-input"
                />
                <Button
                  as="label"
                  htmlFor="file-input"
                  variant="flat"
                  color="primary"
                  size="sm"
                >
                  选择文件
                </Button>
              </div>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                    <FileText size={18} className="text-slate-400" />
                    <span className="text-sm flex-1">{file.name}</span>
                    <span className="text-xs text-slate-400">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isUploading && (
              <Progress value={progress} className="w-full" color="primary" />
            )}

            <Button
              type="submit"
              color="primary"
              isLoading={isUploading}
              isDisabled={files.length === 0}
              className="w-full"
            >
              {isUploading ? '分析中...' : '开始诊断'}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">诊断历史</h3>
        </CardHeader>
        <CardBody>
          {uploads.length === 0 ? (
            <p className="text-slate-500 text-center py-8">暂无诊断记录</p>
          ) : (
            <div className="space-y-3">
              {uploads.map((upload) => (
                <div
                  key={upload.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                >
                  <div>
                    <p className="font-medium">{uploadDisplayTitle(upload)}</p>
                    <p className="text-sm text-slate-500">
                      {upload.subject} · {upload.gradeTerm} · {upload.uploadType}
                    </p>
                  </div>
                  <Chip size="sm" variant="flat" color="primary">
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
