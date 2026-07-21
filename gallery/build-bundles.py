#!/usr/bin/env python3
"""
Build the downloadable verification bundles for the document gallery.

For each sample document this script:
  1. Copies js/trustdid-verify.js into gallery/ (so each document's Verify
     button works both on the site and from an extracted bundle).
  2. Ensures a <document>.vrfy sidecar exists. If one is missing it writes a
     PLACEHOLDER manifest (correct SHA-256 + size, but no valid signature) so
     the structure is complete. It never overwrites an existing .vrfy — so once
     you sign the real ones with your TrustDID key, re-running is safe.
  3. Writes a per-bundle HOW-TO-VERIFY.txt.
  4. Zips {document.html, document.html.vrfy, HOW-TO-VERIFY.txt,
     trustdid-verify.js} into gallery/bundles/<slug>.zip.

Run from anywhere:  python gallery/build-bundles.py
Re-run it after re-signing to refresh the zips with the real .vrfy files.
"""

import hashlib
import json
import os
import shutil
import zipfile

GALLERY = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(GALLERY)
BUNDLES = os.path.join(GALLERY, "bundles")
VERIFIER_SRC = os.path.join(ROOT, "js", "trustdid-verify.js")
VERIFIER_DST = os.path.join(GALLERY, "trustdid-verify.js")
DID = "did:web:jacqueslatour.ca"

# slug (file is <slug>.html)          human title
DOCS = [
    ("legal-opinion",          "Legal Opinion Letter"),
    ("notarial-certificate",   "Notarial Certificate (Certified True Copy)"),
    ("auditor-report",         "Independent Auditor's Report"),
    ("certificate-of-standing","Certificate of Good Standing"),
]

HOWTO = """\
HOW TO VERIFY THIS DOCUMENT
===========================

Document : {title}
File     : {docfile}
Issuer   : {did}

This bundle contains everything needed to confirm two things:
  (1) WHO issued this document, and
  (2) that it has NOT been altered by a single byte since it was signed.

Files in this bundle
---------------------
  {docfile}          the document itself (open it in any web browser)
  {vrfyfile}     the cryptographic signature manifest (the ".vrfy" sidecar)
  trustdid-verify.js      the self-contained verifier used by the document
  HOW-TO-VERIFY.txt       this file

You can verify in any of three ways.

Option 1 - In your browser (easiest)
------------------------------------
  1. Keep all four files together in the same folder.
  2. Open {docfile} in a web browser.
  3. Click the "Verify this document" button near the bottom.
  A green result confirms the signature and that the document is unmodified.
  (An internet connection is needed to resolve the issuer's public identity.)

Option 2 - Online, without trusting this folder
-----------------------------------------------
  1. Host {docfile} and {vrfyfile} at any public URL
     (or use your own copy already published by the issuer).
  2. Go to https://trustdid.ca and paste the document URL.

Option 3 - Command line
-----------------------
  Compute the document's SHA-256 hash and compare it to the "documentHash"
  field inside {vrfyfile}. They must match exactly.

    # macOS / Linux
    shasum -a 256 {docfile}

    # Windows (PowerShell)
    Get-FileHash {docfile} -Algorithm SHA256

  Then confirm the signature over that hash against the issuer's public key,
  published at:  https://jacqueslatour.ca/.well-known/did.json
  The TrustDID toolkit at https://trustdid.ca automates this step.

What a passing result proves
----------------------------
  - The document was signed by the private key behind {did},
    whose public half is anchored to that domain's DNS and TLS certificate.
  - Not one character of the document has changed since signing. If anyone
    edits it, the hash changes and verification fails.

Learn more: https://jacqueslatour.ca/how-it-works/
"""

PLACEHOLDER_HEADER = """\
// =========================================================================
//  TrustDID(TM) -- Digital Document Verification Manifest
//  *** PLACEHOLDER -- NOT YET SIGNED ***
//
//  This sidecar has the correct document hash and metadata, but the proof
//  values below are placeholders. Re-sign this document with your TrustDID
//  private key to produce a valid manifest, then re-run build-bundles.py.
// =========================================================================
"""


def sha256_and_size(path):
    data = open(path, "rb").read()
    return hashlib.sha256(data).hexdigest(), len(data)


def write_placeholder_vrfy(vrfy_path, doc_path, docfile):
    doc_hash, size = sha256_and_size(doc_path)
    manifest = {
        "version": "3.0",
        "type": "VerifiableDocumentSignature",
        "did": DID,
        "payload": {
            "did": DID,
            "documentHash": doc_hash,
            "hashAlgorithm": "SHA-256",
            "timestamp": "PLACEHOLDER",
            "fileName": docfile,
            "fileSize": size,
            "mimeType": "text/html",
        },
        "proof": {
            "type": "Ed25519Signature2020",
            "verificationMethod": DID + "#active",
            "proofPurpose": "assertionMethod",
            "proofValue": "PLACEHOLDER_UNSIGNED",
        },
    }
    with open(vrfy_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(PLACEHOLDER_HEADER)
        json.dump(manifest, f, indent=2)
        f.write("\n")


def main():
    os.makedirs(BUNDLES, exist_ok=True)
    shutil.copyfile(VERIFIER_SRC, VERIFIER_DST)
    print("copied trustdid-verify.js -> gallery/")

    for slug, title in DOCS:
        docfile = slug + ".html"
        vrfyfile = docfile + ".vrfy"
        doc_path = os.path.join(GALLERY, docfile)
        vrfy_path = os.path.join(GALLERY, vrfyfile)

        if not os.path.exists(doc_path):
            print("SKIP (missing document): " + docfile)
            continue

        if os.path.exists(vrfy_path):
            print("kept existing .vrfy      : " + vrfyfile)
        else:
            write_placeholder_vrfy(vrfy_path, doc_path, docfile)
            print("wrote PLACEHOLDER .vrfy  : " + vrfyfile)

        howto = HOWTO.format(title=title, docfile=docfile, vrfyfile=vrfyfile, did=DID)
        zip_path = os.path.join(BUNDLES, slug + ".zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(doc_path, docfile)
            z.write(vrfy_path, vrfyfile)
            z.writestr("HOW-TO-VERIFY.txt", howto)
            z.write(VERIFIER_DST, "trustdid-verify.js")
        print("built bundle             : bundles/" + slug + ".zip")

    print("done.")


if __name__ == "__main__":
    main()
