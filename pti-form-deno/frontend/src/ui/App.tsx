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
  const [busyCompress, setBusyCompress] = useState(false)
  const [busySend, setBusySend] = useState(false)
  const [progress, setProgress] = useState({ compDone: 0, compTotal: 0, sendText: '' })

  const timeInfo = useMemo(() => toChicagoISO(), [])
  const ru = i18n.language.startsWith('ru')
  const L = {
    title: ru ? 'Pre-Trip Inspection' : 'Pre-Trip Inspection',
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
    addPhotos: ru ? 'Добавить фото' : 'Add photos',
    sending:   ru ? 'отправка' : 'sending',
    compressing: ru ? 'сжатие' : 'compressing',
    gpsOff: ru ? 'Геолокация не разрешена' : 'Location not allowed',
  }

  const LangSwitch = () => (
    <div className="flex gap-2 items-center">
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('ru')}>RU</button>
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('en')}>EN</button>
    </div>
  )

  // Progressive compression: create a worker per file and push as soon as ready
  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    const list = Array.from(files)
    setBusyCompress(true)
    setProgress({ compDone: 0, compTotal: list.length, sendText: '' })

    for (let idx = 0; idx < list.length; idx++) {
      await new Promise<void>((resolve) => {
        const worker = new Worker(new URL('../worker/compress.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent) => {
          const { base64, bytes, w, h, mime } = e.data
          const name = `photo_${Date.now()}_${idx + 1}.webp`
          setPhotos(prev => [...prev, { base64, bytes, w, h, mime, filename: name }])
          setProgress(p => ({ ...p, compDone: p.compDone + 1 }))
          worker.terminate()
          resolve()
        }
        worker.postMessage({ file: list[idx], quality: 0.72 })
      })
    }
    setBusyCompress(false)
  }

  const requestGeo = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoAllowed(true)
        setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy })
      },
      () => setGeoAllowed(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  }

  const canNext = () => {
    if (step === 0) return !!firstName && !!lastName && !!truck && !!trailer
    if (step === 1) return photos.length >= 20 // активна даже когда идёт компрессия
    return true
  }

  const submitAll = async () => {
    setBusySend(true)
    try {
      setProgress(p => ({ ...p, sendText: 'summary' }))
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
        setProgress(p => ({ ...p, sendText: `${L.sending} ${i + 1}/${groups.length}` }))
        const media = groups[i].map(p => ({ filename: p.filename, mime: p.mime, data: p.base64 }))
        const r = await fetch(import.meta.env.VITE_API_BASE + '/relay/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit: { truck, trailer }, index: i + 1, total: groups.length, media })
        })
        if (!r.ok) throw new Error('group failed')
        await sleep(1500)
      }
      alert('ok')
      // reset
      setFirstName(''); setLastName(''); setTruck(''); setTrailer(''); setComment('')
      setPhotos([]); setStep(0)
    } catch {
      alert('error')
    } finally {
      setBusySend(false)
      setProgress({ compDone: 0, compTotal: 0, sendText: '' })
    }
  }

  return (
    <div className="min-h-screen p-3">
      <div className="max-w-sm mx-auto">
        <header className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <LangSwitch />
        </header>

        <motion.div className="glass p-4">
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.firstName} value={firstName} onChange={e=>setFirstName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.lastName} value={lastName} onChange={e=>setLastName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.truck} value={truck} onChange={e=>setTruck(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.trailer} value={trailer} onChange={e=>setTrailer(e.target.value)} />
              <textarea className="glass p-3 w-full text-base min-h-[84px]" placeholder={L.comment} value={comment} onChange={e=>setComment(e.target.value)} />
              <div className="text-sm opacity-80">
                {L.timeAuto}: <span className="font-mono">{timeInfo.human}</span>
              </div>
              <button className="btn glass h-12" onClick={requestGeo}>{L.useGeo}</button>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm">{L.photosMin}: <b>{photos.length}</b></div>
              <label className="btn-primary w-full h-12 flex items-center justify-center cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                />
                {L.addPhotos}
              </label>
              {(busyCompress || progress.compDone>0) && (
                <div className="text-sm">
                  {L.compressing} {progress.compDone}/{progress.compTotal || '?'}
                </div>
              )}
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

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm opacity-80">
                {firstName} {lastName} • {truck}/{trailer} • {timeInfo.human}
              </div>
              <div className="text-sm">{photos.length} {ru ? 'из' : 'of'} 20+</div>
              <div className="text-sm">{comment}</div>
              <div className="text-xs opacity-70">
                {geoAllowed && loc.lat && loc.lon
                  ? `GPS: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (±${Math.round(loc.accuracy||0)}m)`
                  : L.gpsOff}
              </div>
            </div>
          )}

          <div className="flex justify-between mt-4">
            {/* Назад всегда работает */}
            <button className="btn glass h-12 px-5" onClick={()=>setStep(s=>Math.max(0, s-1))}>{L.back}</button>

            {step < 2 ? (
              <button
                className="btn-primary h-12 px-5"
                disabled={!canNext() || busySend}
                onClick={()=>setStep(s=>s+1)}
              >
                {L.next}
              </button>
            ) : (
              <button
                className="btn-primary h-12 px-5"
                disabled={busySend || photos.length<20}
                onClick={submitAll}
              >
                {L.submit}
              </button>
            )}
          </div>

          {(busySend || progress.sendText) && (
            <div className="mt-3 text-xs opacity-80">{progress.sendText}</div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
