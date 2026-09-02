import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import type { AppState } from '../types'
import { loadState } from '../api'

interface AppContextValue {
  appState: AppState | null
  setAppState: Dispatch<SetStateAction<AppState | null>>
  refreshState: () => Promise<void>
  isLoading: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshState = useCallback(async () => {
    setIsLoading(true)
    try {
      const state = await loadState()
      setAppState(state)
    } catch (err) {
      console.error('Failed to load state:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshState()
  }, [refreshState])

  return (
    <AppContext.Provider value={{ appState, setAppState, refreshState, isLoading }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}
