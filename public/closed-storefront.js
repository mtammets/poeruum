// The closure page works without the app; a failed logo falls back to its name.
document.querySelectorAll('.closed-store__brand img').forEach((logo) => {
  const showName = () => logo.replaceWith(document.createTextNode(logo.alt))
  logo.addEventListener('error', showName, { once: true })
  if (logo.complete && !logo.naturalWidth) showName()
})
