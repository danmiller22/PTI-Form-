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
  const [loc, setLoc] = useState<{lat?: number, lon?: number, accuracy?: number}>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const timeInfo = useMemo(() => toChicagoISO(), [])

  const ru = i18n.language.startsWith('ru')
  const labels = {
    firstName: ru ? 'Имя' : 'First name',
    lastName:  ru ? 'Фамилия' : 'Last name',
    truck:     ru ? 'Трак №' : 'Truck #',
    trailer:   ru ? 'Трейлер №' : 'Trailer #',
    comment:   ru ? 'Комментарий / дефекты (опц.)' : 'Comments / defects (optional)',
    useGeo:    ru ? 'Использовать текущую геолокацию' : 'Use current location',
    timeAuto:  ru ? 'Время (Америка/Чикаго)' : 'Time (America/Chicago)',
    next:      ru ? 'Далее' : 'Next',
    back:      ru ? 'Назад' : 'Back',
    submit:    ru ? 'Отправить в Telegram' : 'Send to Telegram',
    photosMin: ru ? 'Добавьте минимум 20 фото' : 'Add at least 20 photos',
    added:     ru ? 'добавлено' : 'added',
    of:        ru ? 'из' : 'of',
    title:     ru ? 'PTI осмотр' : 'Pre-Trip Inspection',
  }

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
        location: { ...loc, method: geoAllowed ? 'geolocation' : 'none' }
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
    } catch {
      alert('error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className="min-h-screen p-3">
      <div className="max-w-sm mx-auto">
        <header className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">{labels.title}</h1>
          <LangSwitch />
        </header>

        <motion.div className="glass p-4">
          {/* STEP 0: Driver & Unit, mobile-first */}
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <input className="glass p-3 w-full h-12 text-base" placeholder={labels.firstName} value={firstName} onChange={e=>setFirstName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={labels.lastName} value={lastName} onChange={e=>setLastName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={labels.truck} value={truck} onChange={e=>setTruck(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={labels.trailer} value={trailer} onChange={e=>setTrailer(e.target.value)} />
              <textarea className="glass p-3 w-full text-base min-h-[84px]" placeholder={labels.comment} value={comment} onChange={e=>setComment(e.target.value)} />
              <div className="text-sm opacity-80">
                {labels.timeAuto}: <span className="font-mono">{timeInfo.human}</span>
              </div>
              <button className="btn glass h-12" onClick={requestGeo}>{labels.useGeo}</button>
            </div>
          )}

          {/* STEP 1: Photos */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm">{labels.photosMin}: <b>{photos.length}</b></div>
              <label className="btn-primary w-full h-12 flex items-center justify-center cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                />
                {ru ? 'Добавить фото' : 'Add photos'}
              </label>
              {busy && <div className="text-sm">compressing {progress}</div>}
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="glass p-1 text-[10px]">
                    <img className="w-full h-24 object-cover rounded-lg" src={`data:${p.mime};base64,${p.base64}`} />
                    <div className="mt-1 opacity-80">{Math.round(p.bytes/1024)} KB</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Review */}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm opacity-80">
                {firstName} {lastName} • {truck}/{trailer} • {timeInfo.human}
              </div>
              <div className="text-sm">{photos.length} {labels.of} 20+</div>
              <div className="text-sm">{comment}</div>
              <div className="text-xs opacity-70">
                {geoAllowed && loc.lat && loc.lon
                  ? `GPS: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (±${Math.round(loc.accuracy||0)}m)`
                  : (ru ? 'Геолокация не разрешена' : 'Location not allowed')}
              </div>
            </div>
          )}

          {/* NAV */}
          <div className="flex justify-between mt-4">
            {step > 0 ? (
              <button className="btn glass h-12 px-5" disabled={busy} onClick={()=>setStep(s=>Math.max(0, s-1))}>{labels.back}</button>
            ) : <div />}
            {step < 2 ? (
              <button className="btn-primary h-12 px-5" disabled={!canNext()||busy} onClick={()=>setStep(s=>s+1)}>{labels.next}</button>
            ) : (
              <button className="btn-primary h-12 px-5" disabled={busy || photos.length<20} onClick={submitAll}>{labels.submit}</button>
            )}
          </div>
          {busy && <div className="mt-3 text-xs opacity-80">sending {progress}</div>}
        </motion.div>
      </div>
    </div>
  )
}
