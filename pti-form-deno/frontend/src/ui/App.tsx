import React, { useEffect, useMemo, useRef, useState } from 'react'
import '../i18n'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { chunk, sleep, toChicagoISO } from '../utils'

type PhotoItem = { base64: string, bytes: number, w: number, h: number, mime: string, filename: string }

export default function App() {
  const { i18n } = useTranslation()
  const [step, setStep] = useState(0)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [truck, setTruck]         = useState('')
  const [trailer, setTrailer]     = useState('')
  const [comment, setComment]     = useState('')

  const [photos, setPhotos]       = useState<PhotoItem[]>([])
  const [busyCompress, setBusyCompress] = useState(false)

  const [geoAllowed, setGeoAllowed] = useState(false)
  const [loc, setLoc] = useState<{lat?: number, lon?: number, accuracy?: number}>({})

  const [busySend, setBusySend] = useState(false)
  const [sendText, setSendText] = useState('')
  const [sentOk, setSentOk]     = useState(false)
  const [errorText, setErrorText] = useState('')
  const [dots, setDots] = useState('')

  useEffect(() => {
    if (!busyCompress && !busySend) { setDots(''); return }
    const id = setInterval(() => setDots(p => p.length >= 3 ? '' : p + '.'), 350)
    return () => clearInterval(id)
  }, [busyCompress, busySend])

  const fileInputRef = useRef<HTMLInputElement|null>(null)
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
    submit:    ru ? 'Отправить' : 'Send',
    submitted: ru ? 'Отправлено!' : 'Sent!',
    photosMin: ru ? 'Добавьте минимум 20 фото' : 'Add at least 20 photos',
    addPhotos: ru ? 'Добавить фото' : 'Add photos',
    gpsOff:    ru ? 'Геолокация не разрешена' : 'Location not allowed',
    sending:   ru ? 'отправка' : 'sending',
  }

  const canNext = () => {
    if (step === 0) return !!firstName && !!lastName && !!truck && !!trailer
    if (step === 1) return photos.length >= 20
    return true
  }

  // ---------- FAST COMPRESSION (adaptive, worker pool) ----------
  function compressOnce(file: File, idx: number, quality: number, maxW: number, maxH: number, timeoutMs = 10000): Promise<PhotoItem> {
    return new Promise<PhotoItem>((resolve, reject) => {
      const worker = new Worker(new URL('../worker/compress.ts', import.meta.url), { type: 'module' })
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('timeout')) }, timeoutMs)
      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer)
        const { base64, bytes, w, h, mime } = e.data
        worker.terminate()
        resolve({ base64, bytes, w, h, mime, filename: `photo_${Date.now()}_${idx+1}.webp` })
      }
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('worker error')) }
      worker.postMessage({ file, quality, maxW, maxH })
    })
  }

  async function compressAuto(file: File, idx: number, targetKB = 200): Promise<PhotoItem> {
    // старт быстро: 1200px, q=0.6
    let w = 1200, h = 1200, q = 0.6
    for (let pass = 0; pass < 4; pass++) {
      const item = await compressOnce(file, idx, q, w, h)
      if (item.bytes <= targetKB * 1024) return item
      // уменьшать агрессивно
      if (pass === 0) q = 0.52
      else if (pass === 1) { q = 0.46; w = h = 1024 }
      else { q = 0.42; w = h = 960 }
    }
    return await compressOnce(file, idx, 0.4, 900, 900, 9000)
  }

  async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number, onEach?: (res: T)=>void) {
    return new Promise<void>((resolve) => {
      let i = 0, active = 0
      const kick = () => {
        while (active < concurrency && i < tasks.length) {
          const t = tasks[i++]
          active++
          t().then(r => onEach?.(r)).finally(() => { active--; if (i>=tasks.length && active===0) resolve(); else kick(); })
        }
      }
      kick()
    })
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setErrorText(''); setSentOk(false); setBusyCompress(true)
    const list = Array.from(files)
    const conc = Math.min(8, (navigator as any).hardwareConcurrency || 6) // быстрее
    const tasks = list.map((f, idx)=> () => compressAuto(f, idx, 200).then(item => setPhotos(p=>[...p,item])))
    await runPool(tasks, conc)
    setBusyCompress(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---------- GEO ----------
  const requestGeo = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos)=>{ setGeoAllowed(true); setLoc({lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy}) },
      ()=> setGeoAllowed(false),
      { enableHighAccuracy:true, timeout:7000, maximumAge:0 }
    )
  }

  // ---------- SUBMIT ----------
  const submitAll = async () => {
    setBusySend(true); setSentOk(false); setErrorText('')
    try {
      setSendText('summary')
      const r1 = await fetch(import.meta.env.VITE_API_BASE + '/relay/summary', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          driver:{firstName, lastName},
          unit:{truck, trailer},
          comment, time: timeInfo,
          location:{...loc, method: geoAllowed ? 'geolocation':'none'}
        })
      })
      if (!r1.ok) throw new Error(await r1.text())

      const groups = chunk(photos,10)
      for (let i=0;i<groups.length;i++){
        setSendText(`${L.sending} ${i+1}/${groups.length}`)
        const media = groups[i].map(p=>({filename:p.filename, mime:p.mime, data:p.base64}))
        const r = await fetch(import.meta.env.VITE_API_BASE + '/relay/group', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({unit:{truck,trailer}, index:i+1, total:groups.length, media})
        })
        if (!r.ok) throw new Error(await r.text())
        await sleep(600) // быстрее; 429 обрабатывается бэкендом
      }
      setSentOk(true)
    } catch(e:any) {
      setErrorText(typeof e === 'string' ? e : (e?.message || 'error'))
    } finally {
      setBusySend(false); setSendText('')
    }
  }

  const Spinner = () => (
    <div className="flex flex-col items-center py-2">
      <div className="relative w-6 h-6 mb-1">
        <div className="absolute inset-0 rounded-full opacity-30 animate-ping bg-white"></div>
        <div className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin"
             style={{borderColor:'rgba(255,255,255,0.35)', borderTopColor:'transparent'}} />
      </div>
      <div className="text-xs opacity-80">
        {ru ? `Загрузка фотографий, подождите${dots}` : `Uploading photos, please wait${dots}`}
      </div>
    </div>
  )

  // EN checklist (показываем для RU тоже)
  const checklist = [
    'Truck: front & both sides',
    'Trailer: front & both sides',
    'All tires (full set)',
    'Tires: tread / damage / valve caps',
    'Lights, reflectors, turn signals',
    'Undercarriage, air lines, hoses',
    'Documents: registration + annuals (truck & trailer)',
    'Defects close-ups'
  ]

  return (
    <div className="min-h-screen p-3"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, Roboto, system-ui, Segoe UI, Arial, sans-serif' }}
    >
      <div className="max-w-sm mx-auto">
        <header className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <div className="flex gap-2 items-center">
            <button className="btn glass px-3 py-1" onClick={()=>i18n.changeLanguage('ru')}>RU</button>
            <button className="btn glass px-3 py-1" onClick={()=>i18n.changeLanguage('en')}>EN</button>
          </div>
        </header>

        <motion.div className="glass p-4">
          {step===0 && (
            <div className="flex flex-col gap-3">
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.firstName} value={firstName} onChange={e=>setFirstName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.lastName} value={lastName} onChange={e=>setLastName(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.truck} value={truck} onChange={e=>setTruck(e.target.value)} />
              <input className="glass p-3 w-full h-12 text-base" placeholder={L.trailer} value={trailer} onChange={e=>setTrailer(e.target.value)} />
              <textarea className="glass p-3 w-full text-base min-h-[84px]" placeholder={L.comment} value={comment} onChange={e=>setComment(e.target.value)} />
              <div className="text-sm opacity-80">
                {L.timeAuto}: <span className="font-mono">{timeInfo.human}</span>
              </div>
              <button className={`btn h-12 ${geoAllowed ? 'bg-green-600 text-white' : 'glass'}`} onClick={requestGeo}>
                {L.useGeo}
              </button>
              <div className="flex justify-end">
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(1)}>{L.next}</button>
              </div>
            </div>
          )}

          {step===1 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm">{L.photosMin}: <b>{photos.length}</b></div>

              <div className="glass p-3 text-sm leading-tight">
                <div className="opacity-80 mb-1">{ru ? 'Сфотографируйте обязательно:' : 'Please capture:'}</div>
                <ul className="list-disc pl-5 space-y-1">
                  {checklist.map((it, i)=>(<li key={i}>{it}</li>))}
                </ul>
              </div>

              <label className="btn-primary w-full h-12 flex items-center justify-center cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={e=>handleFiles(e.target.files)}
                />
                {L.addPhotos}
              </label>

              {busyCompress && <Spinner />}

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(0)}>{L.back}</button>
                <button className="btn-primary h-12 px-5" disabled={!canNext() || busySend} onClick={()=>setStep(2)}>{L.next}</button>
              </div>
            </div>
          )}

          {step===2 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm opacity-80">
                {firstName} {lastName} • {truck}/{trailer} • {timeInfo.human}
              </div>
              <div className="text-sm">{photos.length} {ru ? 'из' : 'of'} 20+</div>
              <div className="text-xs opacity-70">
                {geoAllowed && loc.lat && loc.lon
                  ? `GPS: ${loc.lat?.toFixed(5)}, ${loc.lon?.toFixed(5)} (±${Math.round(loc.accuracy||0)}m)`
                  : L.gpsOff}
              </div>

              <div className="flex justify-between mt-2">
                <button className="btn glass h-12 px-5" onClick={()=>setStep(1)}>{L.back}</button>
                <button
                  className={`h-12 px-5 rounded-xl transition ${sentOk ? 'bg-green-600 text-white' : 'btn-primary'}`}
                  disabled={busySend || photos.length<20}
                  onClick={submitAll}
                >
                  {sentOk ? L.submitted : L.submit}
                </button>
              </div>

              {(busySend || sendText) && <Spinner />}
            </div>
          )}

          {errorText && <div className="mt-3 text-xs text-red-400">{errorText}</div>}
        </motion.div>
      </div>
    </div>
  )
}
