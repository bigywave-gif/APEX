import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './store/AppContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import UploadPage from './pages/UploadPage'
import AnalysisPage from './pages/AnalysisPage'
import ReviewPage from './pages/ReviewPage'
import PracticePage from './pages/PracticePage'
import MistakesPage from './pages/MistakesPage'
import ReportsPage from './pages/ReportsPage'
import ModelsPage from './pages/ModelsPage'
import ModelEditorPage from './pages/ModelEditorPage'
import AgentEditorPage from './pages/AgentEditorPage'

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="mistakes" element={<MistakesPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="model-editor" element={<ModelEditorPage />} />
          <Route path="agent-editor" element={<AgentEditorPage />} />
        </Route>
      </Routes>
    </AppProvider>
  )
}
