import React from 'react';
import {Moon,Sun} from 'lucide-react';
import {useFmsTheme} from '../hooks/useFmsTheme';

export const ThemeToggle:React.FC=()=>{const{colorMode,toggleColorMode}=useFmsTheme();return <button type="button" onClick={toggleColorMode} className="fms-btn fms-btn-secondary fms-btn-compact" aria-label={`Switch to Modern ${colorMode==='dark'?'Light':'Dark'}`} title={`Modern ${colorMode==='dark'?'Light':'Dark'}`}>
  {colorMode==='dark'?<Sun className="h-4 w-4"/>:<Moon className="h-4 w-4"/>}<span className="hidden sm:inline">{colorMode==='dark'?'Light':'Dark'}</span>
</button>;};
