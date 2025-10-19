import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  en: {
    translation: {
      title: "Pre-Trip Inspection",
      next: "Next",
      back: "Back",
      submit: "Send to Telegram",
      dataStep: "Driver & Unit",
      photosStep: "Photos",
      reviewStep: "Review",
      firstName: "First name",
      lastName: "Last name",
      truck: "Truck #",
      trailer: "Trailer #",
      comment: "Comments / defects (optional)",
      photosMin: "Add at least 20 photos",
      timeAuto: "Time (America/Chicago)",
      location: "Location",
      useGeo: "Use current location",
      added: "added",
      of: "of"
    }
  },
  ru: {
    translation: {
      title: "PTI осмотр",
      next: "Далее",
      back: "Назад",
      submit: "Отправить в Telegram",
      dataStep: "Водитель и тягач/прицеп",
      photosStep: "Фото",
      reviewStep: "Проверка",
      firstName: "Имя",
      lastName: "Фамилия",
      truck: "Тягач №",
      trailer: "Прицеп №",
      comment: "Комментарий / дефекты (опц.)",
      photosMin: "Добавьте минимум 20 фото",
      timeAuto: "Время (Америка/Чикаго)",
      location: "Локация",
      useGeo: "Использовать текущую геолокацию",
      added: "добавлено",
      of: "из"
    }
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ru',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  })

export default i18n
