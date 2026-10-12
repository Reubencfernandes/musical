import {AudioLines,Music2} from 'lucide-react';
export default function CreateScoreButton({disabled}:{disabled:boolean}){
 return <button type="submit" className="create-score-pill" disabled={disabled} aria-label="Create score">
  <span className="pill-rest" aria-hidden="true">Create score</span>
  <span className="pill-hover" aria-hidden="true"><span className="pill-circles"><span><Music2 size={15}/></span><span><AudioLines size={16}/></span><span>YOU</span></span><span>Let’s transcribe</span></span>
 </button>;
}
