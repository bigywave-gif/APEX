import { useState } from 'react'
import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Chip, Accordion, AccordionItem, Tabs, Tab } from '@heroui/react'
import { ScientificFormula } from '../components/ScientificFormula'

export default function ReviewPage() {
  const { appState } = useAppState()
  const [selectedPackId, setSelectedPackId] = useState('')

  const packs = appState?.reviewPacks || []
  const selectedPack = packs.find((p) => p.id === selectedPackId) || packs[0]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">知识巩固</h2>
        </CardHeader>
        <CardBody>
          {packs.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              暂无知识巩固内容。完成诊断后会自动生成。
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {packs.map((pack) => (
                  <Chip
                    key={pack.id}
                    color={pack.id === selectedPack?.id ? 'primary' : 'default'}
                    variant={pack.id === selectedPack?.id ? 'solid' : 'flat'}
                    className="cursor-pointer"
                    onClick={() => setSelectedPackId(pack.id)}
                  >
                    {pack.knowledge}
                  </Chip>
                ))}
              </div>

              {selectedPack && (
                <Card className="bg-slate-50">
                  <CardBody className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{selectedPack.knowledge}</h3>
                      <Chip
                        color={
                          selectedPack.mastery === '扎实'
                            ? 'success'
                            : selectedPack.mastery === '待巩固'
                            ? 'warning'
                            : 'danger'
                        }
                        variant="flat"
                      >
                        {selectedPack.mastery}
                      </Chip>
                    </div>

                    <Tabs aria-label="知识内容">
                      <Tab key="definition" title="定义与公式">
                        {selectedPack.definitions?.map((def, i) => (
                          <div key={i} className="space-y-2">
                            <p className="text-sm font-medium">{def.concept}</p>
                            <p className="text-sm text-slate-600">{def.definition}</p>
                            {def.formula && <ScientificFormula value={def.formula} className="rounded bg-white p-2 text-sm" />}
                          </div>
                        ))}
                      </Tab>
                      <Tab key="scenario" title="场景讲解">
                        <p className="text-sm text-slate-600">
                          {selectedPack.scenarioExplanation || '暂无场景讲解'}
                        </p>
                      </Tab>
                      <Tab key="errors" title="易错点">
                        {selectedPack.errorBreakdown?.length ? (
                          <ul className="list-disc list-inside space-y-1">
                            {selectedPack.errorBreakdown.map((e, i) => (
                              <li key={i} className="text-sm text-slate-600">
                                {e}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-slate-500">暂无易错点记录</p>
                        )}
                      </Tab>
                    </Tabs>
                  </CardBody>
                </Card>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
