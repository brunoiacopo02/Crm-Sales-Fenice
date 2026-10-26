"use client"

// Accesso al CRM in veste Diretta (collaudo del 25/10/2026: era rimasta la
// grafica vecchia). Stessa logica di sempre: email e password su Supabase Auth.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/utils/supabase/client"

const CAMPO = "block h-11 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[15px] text-[#F2F2F2] placeholder:text-[#8C8C8C] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError("")

        const supabase = createClient()
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (signInError) {
            setError("Credenziali non valide. Riprova.")
            setLoading(false)
        } else {
            router.push("/")
            router.refresh()
        }
    }

    return (
        <div className="flex min-h-screen flex-col justify-center bg-[#171717] px-4 py-12 text-[#F2F2F2]">
            <div className="mx-auto w-full max-w-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/elixir-group-logo.png" alt="Elixir Group" width={977} height={405} className="h-auto w-52" />
                <h1 className="mt-8 text-[36px] font-semibold leading-tight tracking-tight">
                    Elixir Group <span className="text-[#FF9330]">CRM</span>
                </h1>

                <form className="mt-8 flex flex-col gap-5 rounded-[16px] bg-[#262626] p-6 sm:p-8" onSubmit={handleSubmit}>
                    <div>
                        <label htmlFor="email" className="text-[14px] text-[#BFBFBF]">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={`${CAMPO} mt-1.5`}
                        />
                    </div>

                    <div>
                        <label htmlFor="password" className="text-[14px] text-[#BFBFBF]">Password</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={`${CAMPO} mt-1.5`}
                        />
                    </div>

                    {error && <div role="alert" className="text-[14px] font-semibold text-[#FF9330]">{error}</div>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex h-11 w-full items-center justify-center rounded-[8px] bg-[#FF9330] text-[15px] font-semibold text-[#171717] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {loading ? "Accesso in corso" : "Accedi"}
                    </button>
                </form>
            </div>
        </div>
    )
}
