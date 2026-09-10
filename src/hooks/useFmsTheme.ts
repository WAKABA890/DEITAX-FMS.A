import {useCallback,useEffect,useState} from 'react';

export type FmsColorMode='dark'|'light';
const STORAGE_KEY='dt-fms-color-mode';
const EVENT_NAME='dt-fms-color-mode-change';
const readMode=():FmsColorMode=>{
  const stored=localStorage.getItem(STORAGE_KEY);
  if(stored==='dark'||stored==='light')return stored;
  const legacy=String(localStorage.getItem('dt-fms-theme')||localStorage.getItem('fms-theme')||'').toLowerCase();
  return legacy.includes('light')?'light':'dark';
};
const applyMode=(mode:FmsColorMode)=>{
  document.documentElement.dataset.fmsTheme='modern';
  document.documentElement.dataset.fmsMode=mode;
  localStorage.setItem(STORAGE_KEY,mode);
  localStorage.removeItem('dt-fms-theme');
  localStorage.removeItem('fms-theme');
};

export const initializeFmsTheme=():FmsColorMode=>{
  const mode=readMode();
  applyMode(mode);
  return mode;
};

export function useFmsTheme(){
  const [colorMode,setColorModeState]=useState<FmsColorMode>(()=>initializeFmsTheme());
  useEffect(()=>{applyMode(colorMode);},[colorMode]);
  useEffect(()=>{const sync=(event:Event)=>setColorModeState((event as CustomEvent<FmsColorMode>).detail);window.addEventListener(EVENT_NAME,sync);return()=>window.removeEventListener(EVENT_NAME,sync);},[]);
  const setColorMode=useCallback((mode:FmsColorMode)=>{applyMode(mode);setColorModeState(mode);window.dispatchEvent(new CustomEvent(EVENT_NAME,{detail:mode}));},[]);
  const toggleColorMode=useCallback(()=>setColorMode(colorMode==='dark'?'light':'dark'),[colorMode,setColorMode]);
  return{colorMode,setColorMode,toggleColorMode};
}
