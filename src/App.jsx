import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Hei maailma! (testi 2)</h1>
      <p>Tämä julkaistaan Verceliin. Myöhemmin lisätään ChatGPT-haku.</p>
    </div>
  )
}

export default App
