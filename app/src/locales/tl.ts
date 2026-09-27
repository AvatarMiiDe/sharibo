// TODO(i18n): machine-translated, needs native review
// Tagalog (tl) locale. Machine-translated first pass; native review tracked separately.

const tl = {
  // Landing / hero
  "app.title": "ROSCA",
  "app.tagline": "Mga savings circle na pinapatakbo ng komunidad",
  "landing.cta": "Magsimula",
  "landing.learnMore": "Matuto pa",
  "landing.howItWorks": "Paano ito gumagana?",

  // Browser support gate (#315)
  "browser.title": "Hindi suportado ang browser",
  "browser.description": "Kailangan ng app na ito ang isang modernong browser upang tumakbo nang ligtas.",
  "browser.unsupported": "Hindi suportado ang iyong browser.",
  "browser.recommendation": "Mangyaring mag-update sa pinakabagong bersyon ng Chrome, Firefox, Safari, o Edge.",
  "browser.update": "I-update ang browser",
  "browser.dismiss": "Isara",
  "browser.learnMore": "Matuto pa",
  "browser.required": "Kailangan ang modernong browser",
  "browser.detected": "Natukoy na browser",
  "browser.minimum": "Minimum na bersyon",
  "browser.continue": "Magpatuloy pa rin",
  "browser.warning": "Maaaring hindi gumana nang tama ang ilang feature.",
  "browser.help": "Tulong sa browser",

  // Cancel circle (#311)
  "cancel.title": "Kanselahin ang circle",
  "cancel.description": "Ang pagkansela ng circle ay hindi na mababawi.",
  "cancel.confirm": "Kanselahin ang circle",
  "cancel.keep": "Panatilihin ang circle",
  "cancel.reason": "Dahilan (opsyonal)",
  "cancel.success": "Nakansela na ang circle.",
  "cancel.error": "Hindi makansela ang circle. Subukan muli.",

  // Claim / proof generation (#103)
  "claim.title": "I-claim ang iyong kontribusyon",
  "claim.description": "Bumubuo kami ng zero-knowledge proof na nagpapatunay ng iyong pagiging karapat-dapat nang hindi inilalantad ang iyong pagkakakilanlan.",
  "claim.start": "Simulan ang claim",
  "claim.generating": "Bumubuo ng proof…",
  "claim.verifying": "Beripikasyon…",
  "claim.success": "Na-claim na ang iyong kontribusyon.",
  "claim.error": "Nabigo ang claim. Subukan muli.",
  "claim.retry": "Subukan muli",
  "claim.cancel": "Kanselahin",
  "claim.stage.preparing": "Naghahanda…",
  "claim.stage.computing": "Kinukuwenta ang proof…",
  "claim.stage.proving": "Bumubuo ng proof…",
  "claim.stage.submitting": "Isinusumite…",

  // Error boundary (#102)
  "errorBoundary.title": "May nangyaring mali",
  "errorBoundary.description": "Nagkaroon ng hindi inaasahang error. Mangyaring i-reload ang pahina.",
  "errorBoundary.reload": "I-reload ang pahina",
  "errorBoundary.report": "Iulat ang isyu",
  "errorBoundary.details": "Mga detalye ng error",

  // Explainer (#120)
  "explainer.title": "Paano ito gumagana?",
  "explainer.intro": "Ang ROSCA ay isang savings circle kung saan nag-aambag ang bawat miyembro sa bawat round at isa ang tumatanggap ng buong pot.",
  "explainer.step1.title": "Sumali sa circle",
  "explainer.step1.body": "Mag-ambag ng fixed na halaga sa bawat round kasama ang mga pinagkakatiwalaang miyembro.",
  "explainer.step2.title": "Mag-ambag bawat round",
  "explainer.step2.body": "Ang bawat miyembro ay nag-aambag ng parehong halaga sa bawat round.",
  "explainer.step3.title": "Isa ang tumatanggap",
  "explainer.step3.body": "Ang isang miyembro ay tumatanggap ng buong pot sa bawat round, na umiikot hanggang sa lahat ay nakatanggap.",
  "explainer.privacy.title": "Privacy",
  "explainer.privacy.body": "Gumagamit kami ng zero-knowledge proofs upang patunayan ang pagiging karapat-dapat nang hindi inilalantad ang iyong pagkakakilanlan.",
  "explainer.close": "Isara",
  "explainer.next": "Susunod",
  "explainer.back": "Bumalik",

  // Claim result screen
  "result.title": "Resulta ng claim",
  "result.success.title": "Matagumpay ang claim",
  "result.success.body": "Na-verify na ang iyong proof at natanggap mo na ang iyong kontribusyon.",
  "result.failure.title": "Nabigo ang claim",
  "result.failure.body": "Hindi ma-verify ang iyong proof. Mangyaring subukan muli.",
  "result.pending.title": "Nakabinbin ang claim",
  "result.pending.body": "Pinoproseso pa ang iyong claim. Mangyaring maghintay.",
  "result.amount": "Halaga",
  "result.recipient": "Tatanggap",
  "result.timestamp": "Oras",
  "result.transaction": "Transaksyon",
  "result.viewTransaction": "Tingnan ang transaksyon",
  "result.done": "Tapos na",
  "result.close": "Isara",
  "result.retry": "Subukan muli",
  "result.share": "Ibahagi",
  "result.copy": "Kopyahin",
  "result.copied": "Nakopya",
  "result.error": "Error",

  // Session resume (#125)
  "resume.title": "Ipagpatuloy ang session",
  "resume.description": "Mayroon kang hindi natapos na session. Gusto mo bang ipagpatuloy?",
  "resume.continue": "Ipagpatuloy",
  "resume.discard": "Itapon",

  // Fund
  "fund.title": "Pondohan ang circle",
  "fund.description": "Magdeposito ng pondo upang simulan ang circle.",
  "fund.amount": "Halaga",
  "fund.deposit": "Magdeposito",
  "fund.withdraw": "Mag-withdraw",
  "fund.balance": "Balanse",
  "fund.success": "Matagumpay ang transaksyon.",
  "fund.error": "Nabigo ang transaksyon. Subukan muli.",
  "fund.insufficient": "Hindi sapat ang pondo.",
  "fund.pending": "Nakabinbin…",

  // Ring
  "ring.title": "Ring ng mga miyembro",
  "ring.member": "Miyembro",
  "ring.you": "Ikaw",
  "ring.current": "Kasalukuyang tumatanggap",
  "ring.next": "Susunod na tatanggap",

  // Live region (a11y)
  "liveRegion.claimStarted": "Sinimulan ang claim.",
  "liveRegion.claimComplete": "Nakumpleto ang claim.",
  "liveRegion.error": "May naganap na error.",
  "liveRegion.loading": "Naglo-load…",

  // Banner
  "banner.info": "Impormasyon",
  "banner.warning": "Babala",
  "banner.error": "Error",

  // Busy
  "busy.loading": "Naglo-load…",
  "busy.processing": "Pinoproseso…",
  "busy.waiting": "Naghihintay…",
  "busy.saving": "Sine-save…",
  "busy.submitting": "Isinusumite…",

  // Wallet
  "wallet.connect": "Ikonekta ang wallet",
  "wallet.disconnect": "Idiskonekta ang wallet",

  // Copy
  "copy.copy": "Kopyahin",
  "copy.copied": "Nakopya",
};

export default tl;
