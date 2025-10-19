import React, { useMemo, useState } from 'react'
import '../i18n'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { chunk, sleep, toChicagoISO } from '../utils'

type PhotoItem = { base64: string, bytes: number, w: number, h: number, mime: string, filename: string }

export default function App() {
  const { i18n } = useTranslation()
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
  const [compDone, setCompDone] = useState(0)
  const [compTotal, setCompTotal] = useState(0)
  const [sendText, setSendText] = useState('')

  const timeInfo = useMemo(() => toChicagoISO(), [])
  const ru = i18n.language.startsWith('ru')
  const L = {
    title: 'Pre-Trip Inspection',
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
    gpsOff:    ru ? 'Геолокация не разрешена' : 'Location not allowed',
    compressing: ru ? 'сжатие' : 'compressing',
    sending:   ru ? 'отправка' : 'sending',
  }

  const LangSwitch = () => (
    <div className="flex gap-2 items-center">
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('ru')}>RU</button>
      <button className="btn glass px-3 py-1" onClick={() => i18n.changeLanguage('en')}>EN</button>
    </div>
  )

  // Robust sequential compression to avoid dropped files
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setBusyCompress(true)
    setCompDone(0)
    setCompTotal(list.length)

    for (let idx = 0; idx < list.length; idx++) {
      // process sequentially in a dedicated worker
      await new Promise<void>((resolve) => {
        const worker = new Worker(new URL('../worker/compress.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent) => {
          const { base64, bytes, w, h, mime } = e.data
          const name = `photo_${Date.now()}_${idx + 1}.webp`
          setPhotos(prev => [...prev, { base64, bytes, w, h, mime, filename: name }])
          setCompDone(d => d + 1)
          worker.terminate()
          resolve()
        }
        // slightly lower quality to reduce size spikes on large batches
        worker.postMessage({ file: list[idx], quality: 0.65, maxW: 1600, maxH: 1600 })
      })
      // yield to UI
      await new Promise(r => setTimeout(r, 0))
    }
    setBusyCompress(false)
  }

  const requestGeo = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoAllowed(true); setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }) },
      () => setGeoAllowed(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  }

  const canNext = () => {
    if (step === 0) return !!firstName && !!lastName && !!truck && !!trailer
    if (step === 1) return photos.length >= 20    // можно идти далее даже если компрессия ещё крутится
    return true
  }

  const submitAll = async () => {
    setBusySend(true)
    try {
      setSendText('summary')
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
      if (!r1.ok) throw new Error(await r1.text())

      const groups = chunk(photos, 10)
      for (let i = 0; i < groups.length; i++) {
        setSendText(`${L.sending} ${i + 1}/${groups.length}`)
        const media = groups[i].map(p => ({ filename: p.filename, mime: p.mime, data: p.base64 }))
        const r = await fetch(import.meta.env.VITE_API_BASE + '/relay/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit: { truck, trailer }, index: i + 1, total: groups.length, media })
        })
        if (!r.ok) throw new Error(await r.text())
        await sleep(1500)
      }
      alert('ok')
      // reset
      setFirstName(''); setLastName(''); setTruck(''); setTrailer(''); setComment('')
      setPhotos([]); setStep(0)
    } catch (e:any) {
      alert(typeof e === 'string' ? e : (e?.message || 'error'))
    } finally {
      setBusySend(false)
      setSendText('')
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
              <div className="flex justify-end">
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(1)}>{L.next}</button>
              </div>
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
              {(busyCompress || compDone>0) && (
                <div className="text-sm">{L.compressing} {compDone}/{compTotal || '?'}</div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="glass p-1 text-[10px]">
                    <img className="w-full h-24 object-cover rounded-lg" src={`data:${p.mime};base64,${p.base64}`} />
                    <div className="mt-1 opacity-80">{Math.round(p.bytes/1024)} KB</div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(0)}>{L.back}</button>
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(2)}>{L.next}</button>
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

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(1)}>{L.back}</button>
                <button className="btn-primary h-12 px-5" disabled={busySend || photos.length<20} onClick={submitAll}>{L.submit}</button>
              </div>

              {(busySend || sendText) && (
                <div className="mt-3 text-xs opacity-80">{sendText}</div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
