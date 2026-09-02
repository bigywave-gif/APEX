import katex from 'katex'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'

type ScientificFormulaProps = {
  value: string
  className?: string
  displayMode?: boolean
}

function isFormulaExpression(value: string) {
  return /\\[A-Za-z]+|[=<>≤≥≠≈±×÷·√∫∑∞∥⊥△∠½⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉^_]|[A-Za-z0-9)]\s*\/\s*[A-Za-z0-9(]/.test(value)
}

function escapeTexText(value: string) {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}%#$&_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

function stripMathDelimiters(value: string) {
  const text = String(value ?? '').trim()
  const wrappers: Array<[RegExp, string]> = [
    [/^\\\(([\s\S]*)\\\)$/, '$1'],
    [/^\\\[([\s\S]*)\\\]$/, '$1'],
    [/^\$\$([\s\S]*)\$\$$/, '$1'],
    [/^\$([\s\S]*)\$$/, '$1'],
  ]
  return wrappers
    .reduce((current, [pattern, replacement]) => current.replace(pattern, replacement).trim(), text)
    .replace(/\$+\s*([^$]+?)\s*\$+/g, '$1')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .trim()
}

function normalizeFormulaForKatex(value: string) {
  let formula = stripMathDelimiters(value)
    .replace(/“|”/g, '"')
    .replace(/‘|’/g, "'")
    .replace(/①/g, '(1)')
    .replace(/②/g, '(2)')
    .replace(/③/g, '(3)')
    .replace(/④/g, '(4)')
    .replace(/⑤/g, '(5)')
    .replace(/⑥/g, '(6)')
    .replace(/⑦/g, '(7)')
    .replace(/⑧/g, '(8)')
    .replace(/⑨/g, '(9)')
    .replace(/⑩/g, '(10)')
    .replace(/[\u0331\u0332\u0333\u0334]/g, '')
    .replace(/<=>|⇔/g, '\\Leftrightarrow ')
    .replace(/⇒/g, '\\Rightarrow ')
    .replace(/¬/g, '\\neg ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\neq ')
    .replace(/≈/g, '\\approx ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/\\(?:Leftrightarrow|Rightarrow|Leftarrow|leftrightarrow|rightarrow|leftarrow|parallel|approx|equiv|times|cdot|perp|leq|geq|neq|sin|cos|tan|cot|sec|csc|log|div|ln|to|le(?!q)|ge(?!q)|ne(?!q))(?=[A-Za-zΑ-ω])/g, (command) => `${command} `)
  for (let index = 0; index < 8; index += 1) {
    const collapsed = formula.replace(/\\text\{\s*\\text\{([^{}]*)\}\s*\}/g, '\\text{$1}')
    if (collapsed === formula) break
    formula = collapsed
  }
  const protectedText: string[] = []
  formula = formula.replace(/\\text\{([^{}]*)\}/g, (command) => {
    const token = `@@KATEXTEXT${protectedText.length}@@`
    protectedText.push(command)
    return token
  })
  formula = formula.replace(
    /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+(?:\s+[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+)*/g,
    (text) => `\\text{${escapeTexText(text)}}`,
  )
  return formula.replace(/@@KATEXTEXT(\d+)@@/g, (_, index) => protectedText[Number(index)] || '')
}

export function ScientificFormula({ value, className = '', displayMode = true }: ScientificFormulaProps) {
  const rawFormula = String(value || '').trim()
  if (!rawFormula) return null
  if (!isFormulaExpression(rawFormula)) {
    return displayMode
      ? <p className={className}>{rawFormula}</p>
      : <span className={className}>{rawFormula}</span>
  }
  const Tag = displayMode ? 'div' : 'span'
  try {
    const formula = normalizeFormulaForKatex(rawFormula)
    const html = katex.renderToString(formula, {
      displayMode,
      output: 'htmlAndMathml',
      strict: 'error',
      throwOnError: true,
      trust: false,
    })

    return (
      <Tag
        className={`${displayMode ? 'overflow-x-auto' : 'inline-formula-text'} ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return displayMode
      ? <p className={className}>{rawFormula}</p>
      : <span className={className}>{rawFormula}</span>
  }
}
