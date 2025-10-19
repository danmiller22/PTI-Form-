import React, { useMemo, useState } from 'react'
import '../i18n'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { chunk, sleep, toChicagoISO } from '../utils'

type PhotoItem = { base64: string, bytes: number, w: number, h: number, mime: string, filename: string }

export default function App() {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState(0)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [truck, setTruck] = useState('')
  const [trailer, setTrailer] = useState('')
  const [comment, setComment] = useState('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [geoAllowed, setGeoAllowed] = useState(false)
  const [loc, setLoc] = useState<{lat?: number, lon?: number, accuracy?: number, text?: string}>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const timeInfo = useMemo(() => toChicagoISO(), [])

  const LangSwitch = () => (
    <div className="flex gap-2 items-center">
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('ru')}>RU</button>
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('en')}>EN</button>
    </div>
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    setBusy(true)
    const worker = new Worker(new URL('../worker/compress.ts', import.meta.url), { type: 'module' })
    const compressed: PhotoItem[] = []
    let processed = 0
    await Promise.all(Array.from(files).map((file, idx) => new Promise<void>((resolve) => {
      worker.onmessage = (e: MessageEvent) => {
        const { base64, bytes, w, h, mime } = e.data
        const name = `photo_${idx + 1}.webp`
        compressed.push({ base64, bytes, w, h, mime, filename: name })
        processed++
        setProgress(`${processed}/${files.length}`)
        resolve()
      }
      worker.postMessage({ file, quality: 0.72 })
    })))
    worker.terminate()
    setPhotos(p => [...p, ...compressed])
    setBusy(false)
  }

  const requestGeo = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoAllowed(true)
        setLoc({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        })
      },
      () => setGeoAllowed(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  }

  const canNext = () => {
    if (step === 0) return !!firstName && !!lastName && !!truck && !!trailer
    if (step === 1) return photos.length >= 20
    return true
  }

  const submitAll = async () => {
    setBusy(true)
    try {
      setProgress('summary')
      const payloadSummary = {
        driver: { firstName, lastName },
        unit: { truck, trailer },
        comment,
        time: timeInfo,
        location: { ...loc, method: geoAllowed ? 'geolocation' : (loc.text ? 'manual' : 'none') }
      }
      const r1 = await fetch(import.meta.env.VITE_API_BASE + '/relay/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadSummary)
      })
      if (!r1.ok) throw new Error('summary failed')

      const groups = chunk(photos, 10)
      for (let i = 0; i < groups.length; i++) {
        setProgress(`group ${i+1}/${groups.length}`)
        const media = groups[i].map((p) => ({
          filename: p.filename,
          mime: p.mime,
          data: p.base64
        }))
        const r = await fetch(import.meta.env.VITE_API_BASE + '/relay/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: { truck, trailer },
            index: i + 1,
            total: groups.length,
            media
          })
        })
        if (!r.ok) throw new Error('group failed')
        await sleep(1500)
      }
      alert('ok')
      setFirstName(''); setLastName(''); setTruck(''); setTrailer(''); setComment(''); setPhotos([])
      setStep(0)
    } catch (e) {
      alert('error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <LangSwitch />
        </header>

        <motion.div className="glass p-5">
          {step === 0 && (
            <div className="grid gap-4">
              <div className="grid md:grid-cols-2 gap-3">
                <input className="glass p-3" placeholder={t('firstName')!} value={firstName} onChange={e=>setFirstName(e.target.value)} />
                <input className="glass p-3" placeholder={t('lastName')!} value={lastName} onChange={e=>setLastName(e.target.value)} />
                <input className="glass p-3" placeholder={t('truck')!} value={truck} onChange={e=>setTruck(e.target.value)} />
                <input className="glass p-3" placeholder={t('trailer')!} value={trailer} onChange={e=>setTrailer(e.target.value)} />
                <textarea className="glass p-3 md:col-span-2" placeholder={t('comment')!} value={comment} onChange={e=>setComment(e.target.value)} />
              </div>
              <div className="grid md:grid-cols-2 gap-3 items-center">
                <div className="text-sm opacity-80">
                  <div>{t('timeAuto')!}: <span className="font-mono">{timeInfo.human}</span></div>
                </div>
                <div className="flex gap-2">
                  <button className="btn glass" onClick={requestGeo}>{t('useGeo')}</button>
                  <input className="glass p-2 flex-1" placeholder={t('location')!} onChange={e => setLoc(l => ({...l, text: e.target.value}))}/>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <div className="text-sm">{t('photosMin')!}: <b>{photos.length}</b></div>
              <input type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} />
              {busy && <div className="text-sm">compressing {progress}</div>}
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="glass p-1 text-xs">
                    <img className="w-full h-24 object-cover rounded-lg" src={`data:${p.mime};base64,${p.base64}`} />
                    <div className="mt-1 opacity-80">{Math.round(p.bytes/1024)} KB</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <div className="text-sm opacity-80">
                {firstName} {lastName} • {truck}/{trailer} • {timeInfo.human}
              </div>
              <div className="text-sm">{photos.length} {t('of')} 20+</div>
              <div className="text-sm">{comment}</div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button className="btn glass" disabled={step===0||busy} onClick={()=>setStep(s=>s-1)}>{t('back')}</button>
            {step<2 ? (
              <button className="btn-primary" disabled={!canNext()||busy} onClick={()=>setStep(s=>s+1)}>{t('next')}</button>
            ) : (
              <button className="btn-primary" disabled={busy || photos.length<20} onClick={submitAll}>{t('submit')}</button>
            )}
          </div>
          {busy && <div className="mt-3 text-xs opacity-80">sending {progress}</div>}
        </motion.div>
      </div>
    </div>
  )
}
