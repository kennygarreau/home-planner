import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { ACTIVE_STATUSES } from './survey'

// Polls one survey's points and the connected agents. Fast while a
// measurement is queued/running, slow otherwise, paused when disabled.
export function useSurvey(surveyId, enabled) {
  const [state, setState] = useState({ survey: null, points: [], agents: [] })
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!surveyId) return null
    try {
      const s = await api.getSurveyState(surveyId)
      if (alive.current) { setState(s); setError(null) }
      return s
    } catch (e) {
      if (alive.current) setError(e.message)
      return null
    }
  }, [surveyId])

  useEffect(() => {
    alive.current = true
    setState({ survey: null, points: [], agents: [] })
    if (!enabled || !surveyId) return () => { alive.current = false }
    const loop = async () => {
      const s = await refresh()
      const busy = s?.points?.some((p) => ACTIVE_STATUSES.includes(p.status))
      if (alive.current) timer.current = setTimeout(loop, busy ? 1500 : 5000)
    }
    loop()
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [surveyId, enabled, refresh])

  return { ...state, error, refresh }
}
