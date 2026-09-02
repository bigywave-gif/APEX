import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useAppState } from '../store/AppContext'
import {
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  Button,
  Spinner,
  Avatar,
} from '@heroui/react'
import {
  Home,
  Upload,
  BookOpen,
  GraduationCap,
  FileText,
  BarChart3,
  Settings,
  AlertCircle,
  FlaskConical,
} from 'lucide-react'

const navItems = [
  { path: '/', label: '学习总览', icon: Home },
  { path: '/upload', label: '作业诊断', icon: Upload },
  { path: '/analysis', label: '分析报告', icon: BookOpen },
  { path: '/review', label: '知识巩固', icon: GraduationCap },
  { path: '/practice', label: '习题训练', icon: FlaskConical },
  { path: '/mistakes', label: '历史错题', icon: AlertCircle },
  { path: '/reports', label: '成长报告', icon: BarChart3 },
  { path: '/models', label: '模型设置', icon: Settings },
]

export default function Layout() {
  const { appState, isLoading } = useAppState()
  const location = useLocation()
  const student = appState?.student

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed h-full z-20">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-900">学力诊断台</h1>
          <p className="text-xs text-slate-500 mt-1">智能学习分析与训练平台</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3">
            <Avatar
              name={student?.name || '学生'}
              size="sm"
              className="bg-blue-600 text-white"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {student?.name || '学生'}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {student?.grade || '未设置年级'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64">
        <Navbar className="bg-white/80 backdrop-blur-md border-b border-slate-200" maxWidth="full">
          <NavbarBrand>
            <span className="text-sm text-slate-500">
              {navItems.find((n) => n.path === location.pathname)?.label || '学力诊断台'}
            </span>
          </NavbarBrand>
          <NavbarContent justify="end">
            <NavbarItem>
              <Button
                size="sm"
                variant="flat"
                color="danger"
                onPress={async () => {
                  if (confirm('确定要重置所有数据吗？此操作不可恢复。')) {
                    await fetch('/api/reset', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ keepModels: true }),
                    })
                    window.location.reload()
                  }
                }}
              >
                重置数据
              </Button>
            </NavbarItem>
          </NavbarContent>
        </Navbar>

        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
