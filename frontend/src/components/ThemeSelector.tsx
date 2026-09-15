import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../theme/ThemeContext';

const options: Array<{value:ThemePreference;label:string;icon:typeof Sun}>=[{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon},{value:'system',label:'System',icon:Monitor}];
export default function ThemeSelector({compact=false}:{compact?:boolean}){const{preference,setPreference}=useTheme();return <label className="theme-selector"><span className="sr-only">Color theme</span><select aria-label="Color theme" value={preference} onChange={event=>setPreference(event.target.value as ThemePreference)}>{options.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>{!compact&&<span aria-hidden="true" className="theme-selector-icon">{(()=>{const Icon=options.find(item=>item.value===preference)?.icon||Monitor;return <Icon className="h-4 w-4"/>})()}</span>}</label>}
