'use client';

import { useState, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { getSoundsEnabled, setSoundsEnabled, playSound } from '@/lib/soundEngine';

export function SoundToggle() {
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        setEnabled(getSoundsEnabled());
    }, []);

    const toggle = () => {
        const newValue = !enabled;
        setEnabled(newValue);
        setSoundsEnabled(newValue);
        // Play a preview sound when enabling
        if (newValue) {
            playSound('coin_earned');
        }
    };

    return (
        <div className="flex items-center justify-between p-4 bg-white border border-ash-200 rounded-xl">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${enabled ? 'bg-brand-orange-100' : 'bg-ash-100'}`}>
                    {enabled
                        ? <Volume2 className="w-4 h-4 text-brand-orange-600" />
                        : <VolumeX className="w-4 h-4 text-ash-400" />
                    }
                </div>
                <div>
                    <div className="text-sm font-semibold text-ash-800">Effetti Sonori</div>
                    <div className="text-xs text-ash-500">Suoni per coin, XP, level-up e quest</div>
                </div>
            </div>
            <button
                onClick={toggle}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                    enabled ? 'bg-brand-orange' : 'bg-ash-300'
                }`}
            >
                <div
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: enabled ? '22px' : '2px' }}
                />
            </button>
        </div>
    );
}
