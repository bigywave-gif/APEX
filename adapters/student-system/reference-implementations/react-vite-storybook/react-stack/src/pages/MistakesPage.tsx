import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Chip, Accordion, AccordionItem } from '@heroui/react'
import { AlertCircle } from 'lucide-react'

export default function MistakesPage() {
  const { appState } = useAppState()
  const mistakes = appState?.mistakes || []

  const grouped = mistakes.reduce((acc, m) => {
    const key = m.knowledge
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {} as Record<string, typeof mistakes>)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">历史错题</h2>
        </CardHeader>
        <CardBody>
          {mistakes.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无错题记录。完成诊断或练习后，做错的题目会在这里归档。
            </p>
          ) : (
            <Accordion>
              {Object.entries(grouped).map(([knowledge, items]) => (
                <AccordionItem
                  key={knowledge}
                  title={
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} className="text-amber-500" />
                      <span>{knowledge}</span>
                      <Chip size="sm" variant="flat" color="danger">
                        {items.length} 题
                      </Chip>
                    </div>
                  }
                >
                  <div className="space-y-3 pb-4">
                    {items.map((m) => (
                      <Card key={m.id} className="bg-slate-50">
                        <CardBody className="space-y-2">
                          <p className="text-sm font-medium">{m.stem}</p>
                          <div className="flex gap-4 text-sm">
                            <span className="text-red-600">
                              你的答案：{m.studentAnswer || '未作答'}
                            </span>
                            <span className="text-green-600">
                              正确答案：{m.correctAnswer}
                            </span>
                          </div>
                          {m.cause && (
                            <p className="text-sm text-amber-600">
                              错因：{m.cause}
                            </p>
                          )}
                          {m.explanation && (
                            <p className="text-sm text-slate-600">
                              解析：{m.explanation}
                            </p>
                          )}
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
