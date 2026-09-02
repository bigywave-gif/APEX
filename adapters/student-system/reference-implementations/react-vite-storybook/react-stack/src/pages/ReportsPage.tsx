import { useState } from 'react'
import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Chip } from '@heroui/react'
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react'

function reportDisplayTitle(report: { displayTitle?: string; materialTitle?: string; uploadType?: string }) {
  return report.displayTitle || report.materialTitle || report.uploadType || '学习材料'
}

export default function ReportsPage() {
  const { appState } = useAppState()
  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')

  const reports = appState?.reports || []
  const practices = appState?.practices || []
  const weaknesses = appState?.weaknesses || []

  const grades = Array.from(new Set(reports.map((r) => r.gradeTerm).filter(Boolean)))
  if (!selectedGrade && grades.length > 0) setSelectedGrade(grades[0])

  const subjects = Array.from(
    new Set(
      reports
        .filter((r) => !selectedGrade || r.gradeTerm === selectedGrade)
        .map((r) => r.subject)
        .filter(Boolean)
    )
  )

  const filteredReports = reports.filter(
    (r) =>
      (!selectedGrade || r.gradeTerm === selectedGrade) &&
      (!selectedSubject || r.subject === selectedSubject)
  )

  const completedPractices = practices.filter((p) => p.status === '已完成')
  const avgAccuracy =
    completedPractices.length > 0
      ? completedPractices.reduce((s, p) => s + (p.accuracy || 0), 0) /
        completedPractices.length
      : 0

  const weakCount = weaknesses.filter((w) => w.status === '薄弱').length
  const solidCount = weaknesses.filter((w) => w.status === '扎实').length

  const normalizedSubjectValue = selectedSubject || 'all'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">成长档案</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-4 mb-6">
            <label className="flex w-48 flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">年级</span>
              <select
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={selectedGrade}
                onChange={(event) => {
                  setSelectedGrade(event.target.value)
                  setSelectedSubject('')
                }}
              >
                {grades.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-48 flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">科目</span>
              <select
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={normalizedSubjectValue}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setSelectedSubject(nextValue === 'all' ? '' : nextValue)
                }}
              >
                <option value="all">全部科目</option>
                {subjects.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="bg-blue-50">
              <CardBody className="flex flex-row items-center gap-4">
                <BarChart3 className="text-blue-600" size={24} />
                <div>
                  <p className="text-2xl font-bold">{filteredReports.length}</p>
                  <p className="text-sm text-slate-500">报告数</p>
                </div>
              </CardBody>
            </Card>

            <Card className="bg-green-50">
              <CardBody className="flex flex-row items-center gap-4">
                <TrendingUp className="text-green-600" size={24} />
                <div>
                  <p className="text-2xl font-bold">
                    {Math.round(avgAccuracy * 100)}%
                  </p>
                  <p className="text-sm text-slate-500">平均正确率</p>
                </div>
              </CardBody>
            </Card>

            <Card className="bg-amber-50">
              <CardBody className="flex flex-row items-center gap-4">
                <TrendingDown className="text-amber-600" size={24} />
                <div>
                  <p className="text-2xl font-bold">{weakCount}</p>
                  <p className="text-sm text-slate-500">薄弱点</p>
                </div>
              </CardBody>
            </Card>

            <Card className="bg-purple-50">
              <CardBody className="flex flex-row items-center gap-4">
                <BarChart3 className="text-purple-600" size={24} />
                <div>
                  <p className="text-2xl font-bold">{solidCount}</p>
                  <p className="text-sm text-slate-500">扎实点</p>
                </div>
              </CardBody>
            </Card>
          </div>

          {filteredReports.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              当前选择下暂无成长档案
            </p>
          ) : (
            <div className="space-y-3">
              {filteredReports.map((report) => (
                <Card key={report.id} className="bg-slate-50">
                  <CardBody>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{report.type}</p>
                        <p className="text-sm text-slate-500">
                          {report.subject} · {reportDisplayTitle(report)}
                        </p>
                        <p className="text-sm text-slate-600 mt-2">
                          {report.recommendation}
                        </p>
                      </div>
                      <Chip
                        color={report.accuracy >= 0.9 ? 'success' : report.accuracy >= 0.7 ? 'warning' : 'danger'}
                        variant="flat"
                        size="sm"
                      >
                        {Math.round(report.accuracy * 100)}%
                      </Chip>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
