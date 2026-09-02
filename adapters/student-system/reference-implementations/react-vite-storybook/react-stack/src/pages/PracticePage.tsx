import { useState } from 'react'
import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Button, Chip, Progress, RadioGroup, Radio } from '@heroui/react'

export default function PracticePage() {
  const { appState } = useAppState()
  const [activePractice, setActivePractice] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const practices = appState?.practices || []
  const currentPractice = practices.find((p) => p.id === activePractice)

  function handleSubmit() {
    // TODO: Submit answers
    setActivePractice(null)
    setAnswers({})
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">习题训练</h2>
        </CardHeader>
        <CardBody>
          {practices.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无练习记录。完成诊断后可在知识巩固页面生成练习卷。
            </p>
          ) : !currentPractice ? (
            <div className="space-y-3">
              {practices.map((practice) => (
                <div
                  key={practice.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                  onClick={() => setActivePractice(practice.id)}
                >
                  <div>
                    <p className="font-medium">
                      {practice.practiceMode === 'concept' ? '知识点练习' : '对应练习'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {practice.subject} · {practice.knowledge}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Chip
                      color={practice.status === '已完成' ? 'success' : 'primary'}
                      variant="flat"
                      size="sm"
                    >
                      {practice.status}
                    </Chip>
                    {practice.accuracy > 0 && (
                      <span className="text-sm text-slate-500">
                        正确率 {Math.round(practice.accuracy * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {currentPractice.subject} · {currentPractice.knowledge}
                </h3>
                <Button size="sm" variant="flat" onPress={() => setActivePractice(null)}>
                  返回列表
                </Button>
              </div>

              <Progress
                value={
                  (Object.keys(answers).length /
                    (currentPractice.questions?.length || 1)) *
                  100
                }
                className="w-full"
                color="primary"
              />

              <div className="space-y-6">
                {currentPractice.questions?.map((q, idx) => (
                  <Card key={q.id}>
                    <CardBody className="space-y-4">
                      <p className="font-medium">
                        {idx + 1}. {q.stem}
                      </p>

                      {q.type === '选择题' && q.options?.length ? (
                        <RadioGroup
                          value={answers[q.id] || ''}
                          onValueChange={(val) =>
                            setAnswers({ ...answers, [q.id]: val })
                          }
                        >
                          {q.options.map((opt) => (
                            <Radio key={opt.option} value={opt.option}>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{opt.option}.</span>
                                <span className="text-sm">{opt.content}</span>
                              </div>
                            </Radio>
                          ))}
                        </RadioGroup>
                      ) : (
                        <textarea
                          className="w-full p-3 border rounded-lg text-sm"
                          rows={3}
                          placeholder="请输入答案..."
                          value={answers[q.id] || ''}
                          onChange={(e) =>
                            setAnswers({ ...answers, [q.id]: e.target.value })
                          }
                        />
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>

              <Button
                color="primary"
                size="lg"
                className="w-full"
                onPress={handleSubmit}
              >
                提交作答
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
