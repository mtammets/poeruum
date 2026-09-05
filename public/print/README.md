Print color assets
==================

`output-intent.pdf` is a blank PDF containing the PSO Coated v3 CMYK output
intent (FOGRA51, premium coated paper, ISO 12647-2:2013, 300% total ink).
The profile is embedded in the PDF, as expressly permitted by its copyright
notice; the standalone profile is not redistributed. It is used as the base
document for the business-card export, which replaces the blank page.

Source: European Color Initiative, https://eci.org/lib/exe/pso-coated_v3.zip
Profile copyright: European Color Initiative / Heidelberger Druckmaschinen AG,
2015. The embedded profile retains its full original copyright notice.

`sRGB-v2-magic.icc` comes from Compact ICC Profiles by Clinton Ingram,
https://github.com/saucecontrol/Compact-ICC-Profiles, under CC0 1.0.
The original license is in `sRGB-CC0-LICENSE.txt`.

The browser normalizes uploaded images to sRGB. The generated PDF assigns this
source profile and retains the CMYK print output intent; RGB color conversion
is performed by the print workflow. This is not a CMYK-only PDF/X-1a export.

The PDF exporter writes PDF/X-4 structures and checks the supported input model.
Structural tests and Ghostscript rendering are not independent ISO conformance
certification. A printer requiring a specific paper profile or PDF/X-1a still
needs a print-workflow conversion/preflight.
