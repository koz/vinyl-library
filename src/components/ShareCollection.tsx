import { useEffect, useState } from 'react'
import type { CollectionItem } from '../lib/collection'
import { createShareUrl, ShareTooLargeError } from '../lib/shared-collection'
import { ButtonLabel } from './ButtonLabel'

type ShareState = { username: string; items: CollectionItem[] } & (
  { url: string; error?: never } | { url?: never; error: string }
)

export function ShareCollection({ username, items }: { username: string; items: CollectionItem[] | null }) {
  const [result, setResult] = useState<ShareState | null>(null)
  const [copying, setCopying] = useState(false)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const current = result?.username === username && result.items === items ? result : null

  // Prepare the URL before the click so clipboard access keeps the user's browser activation.
  useEffect(() => {
    let active = true
    setResult(null)
    if (!items) return
    createShareUrl(window.location.origin, { username, items }).then(
      (url) => { if (active) setResult({ username, items, url }) },
      (error) => {
        if (active) setResult({ username, items, error: error instanceof ShareTooLargeError
          ? error.message : 'Couldn’t create a share link. Please try again.' })
      },
    )
    return () => { active = false }
  }, [username, items])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.error ? 5_000 : 3_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function copyLink() {
    if (!current || copying) return
    if (current.url === undefined) {
      setToast({ message: current.error, error: true })
      return
    }
    setCopying(true)
    try {
      await navigator.clipboard.writeText(current.url)
      setToast({ message: 'Copied to clipboard', error: false })
    } catch {
      setToast({ message: 'Couldn’t copy the link. Please try again.', error: true })
    } finally {
      setCopying(false)
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={copyLink}
        disabled={!current || copying} aria-busy={!current || copying}>
        <ButtonLabel>Share</ButtonLabel>
      </button>
      {toast && (
        <div className={`toast${toast.error ? ' toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          {toast.message}
        </div>
      )}
    </>
  )
}
