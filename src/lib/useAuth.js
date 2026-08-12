import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// Central auth hook: tracks the Supabase session and the linked profile row
// (which carries the `role`: hotel | supplier | admin), plus the hotel/supplier
// record that belongs to that profile.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [orgRecord, setOrgRecord] = useState(null) // hotels row or suppliers row
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setOrgRecord(null)
      return
    }
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(profileRow || null)

    if (profileRow?.role === 'hotel') {
      const { data } = await supabase
        .from('hotels')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle()
      setOrgRecord(data || null)
    } else if (profileRow?.role === 'supplier') {
      const { data } = await supabase
        .from('suppliers')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle()
      setOrgRecord(data || null)
    } else {
      setOrgRecord(null)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      loadProfile(session?.user?.id).finally(() => setLoading(false))
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      loadProfile(session?.user?.id)
    })

    return () => listener.subscription.unsubscribe()
  }, [loadProfile])

  const refreshOrgRecord = useCallback(() => {
    if (session?.user?.id) loadProfile(session.user.id)
  }, [session, loadProfile])

  const signOut = () => supabase.auth.signOut()

  return { session, profile, orgRecord, loading, signOut, refreshOrgRecord }
}
