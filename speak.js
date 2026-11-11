// THE LAST SIGNAL - spoken dialogue (Web Speech API).
// Zero cost, no API key, no audio files: the browser's own speechSynthesis
// reads each dialogue line out loud in the speaking character's voice.
// The on-screen text stays exactly as it is; speech is an addition, never
// a replacement. If the browser has no speechSynthesis, or the player mutes
// it, the game plays exactly as before with no errors and nothing blocked.
// Voices come from the player's own device and browser (on Windows 11 the
// PC's built-in Microsoft voices are used), so which voice is picked depends
// on the browser and OS. Pitch and rate are what make the characters sound
// different, and those always apply. The speaking gesture is tied to the
// dialogue line, so it runs even when the voice is muted or unavailable.

import { characterKey, setSpeakingCharacter, clearSpeakingCharacter } from './gestures.js';

const VOICE_PROFILES = {
  // pitch: 0 to 2 (1 is the voice's natural pitch). rate: 0.1 to 10.
  // voice: 'female', 'male' or 'any' - a preference for picking a built-in
  // voice by name; if no matching voice exists, the browser default is used.
  jade:    { pitch: 1.15, rate: 1.0,  voice: 'female' },
  caleb:   { pitch: 0.9,  rate: 1.08, voice: 'male' },
  nurse:   { pitch: 1.2,  rate: 0.95, voice: 'female' },
  walter:  { pitch: 0.75, rate: 0.9,  voice: 'male' },
  derrick: { pitch: 0.7,  rate: 0.92, voice: 'male' },
  guard:   { pitch: 0.85, rate: 0.95, voice: 'male' },
  judge:   { pitch: 0.7,  rate: 0.88, voice: 'male' },
  owen:    { pitch: 0.75, rate: 0.9,  voice: 'male' },
  ag:      { pitch: 0.75, rate: 0.9,  voice: 'male' },
  mta:     { pitch: 1.0,  rate: 1.1,  voice: 'male' },
  leader:  { pitch: 0.95, rate: 1.05, voice: 'male' },
  radio:   { pitch: 1.0,  rate: 1.15, voice: 'any' },
  system:  { pitch: 1.0,  rate: 0.95, voice: 'any' },
};
const DEFAULT_VOICE = { pitch: 1.0, rate: 1.0, voice: 'any' };

// Name hints for picking a built-in voice. Windows 11 Chrome and Edge
// expose Microsoft voices such as Zira, Aria, Jenny (female) and David,
// Guy (male); other systems expose their own, and the hints cover the
// common ones. If nothing matches, the browser default voice is used.
const FEMALE_HINTS = ['zira', 'aria', 'jenny', 'female', 'samantha', 'karen', 'moira', 'tessa', 'veena', 'fiona', 'susan', 'allison', 'joana', 'serena'];
const MALE_HINTS = ['david', 'guy', 'mark', 'male', 'daniel', 'alex', 'fred', 'james', 'thomas', 'aaron', 'ryan'];

const MUTE_KEY = 'lastSignalVoiceMuted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

let voiceCache = null;
function loadVoices() {
  try {
    const v = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (v && v.length) voiceCache = v;
  } catch (e) { /* no voices */ }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* older browsers */ }
}

export function isSpeechAvailable() {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window && !!window.speechSynthesis;
  } catch (e) { return false; }
}

function pickVoice(profile) {
  const voices = voiceCache || [];
  if (!voices.length) return null;
  const en = voices.filter(v => v.lang && v.lang.toLowerCase().indexOf('en') === 0);
  const pool = en.length ? en : voices;
  const hints = profile.voice === 'female' ? FEMALE_HINTS : (profile.voice === 'male' ? MALE_HINTS : null);
  if (hints) {
    for (const v of pool) {
      const name = (v.name || '').toLowerCase();
      for (const h of hints) if (name.indexOf(h) !== -1) return v;
    }
  }
  return pool[0] || null;
}

function voiceProfileFor(who) {
  const key = characterKey(who);
  return VOICE_PROFILES[key] || VOICE_PROFILES[key.replace(/[0-9]+$/, '')] || DEFAULT_VOICE;
}

// Speak one dialogue line in the speaking character's voice, and start
// their speaking gesture. The gesture runs even when the voice is muted or
// unavailable, because it is tied to the line being shown, not the audio.
export function speakLine(who, text) {
  try { setSpeakingCharacter(who); } catch (e) { /* gesture is best effort */ }
  if (muted || !text) return;
  if (!isSpeechAvailable()) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    const profile = voiceProfileFor(who);
    const u = new SpeechSynthesisUtterance(String(text));
    u.pitch = profile.pitch;
    u.rate = profile.rate;
    u.volume = 1;
    const voice = pickVoice(profile);
    if (voice) u.voice = voice;
    synth.resume();
    synth.speak(u);
  } catch (e) { /* speech must never break the game */ }
}

function stopAudio() {
  try { if (isSpeechAvailable()) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}

// Stop the voice and the speaking gesture. Call when a dialogue closes.
export function stopSpeaking() {
  stopAudio();
  try { clearSpeakingCharacter(); } catch (e) { /* ignore */ }
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* private mode */ }
  if (muted) stopAudio();
  updateVoiceButton();
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

function updateVoiceButton() {
  try {
    const b = document.getElementById('voiceBtn');
    if (!b) return;
    if (!isSpeechAvailable()) {
      b.textContent = '🔇 Voice off';
      b.classList.add('voice-off');
      b.title = 'Spoken dialogue is not supported in this browser';
      b.disabled = true;
      return;
    }
    b.disabled = false;
    b.textContent = muted ? '🔇 Voice off' : '🔊 Voice on';
    b.classList.toggle('voice-off', muted);
    b.title = muted ? 'Spoken dialogue is off - click to turn it on' : 'Spoken dialogue is on - click to mute';
  } catch (e) { /* button is best effort */ }
}

// Wire the HUD speaker button and unlock speech on first interaction.
// Browsers can pause speech until the player clicks or presses a key, so
// resume on the first pointer or key event to keep the first line audible.
export function initVoiceUI() {
  updateVoiceButton();
  try {
    const b = document.getElementById('voiceBtn');
    if (b && isSpeechAvailable()) {
      b.onclick = () => toggleMuted();
    }
    const unlock = () => {
      try { if (isSpeechAvailable()) window.speechSynthesis.resume(); } catch (e) { /* ignore */ }
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  } catch (e) { /* voice UI is best effort */ }
}
