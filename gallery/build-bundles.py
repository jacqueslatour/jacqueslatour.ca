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
  4. Zips {document.html, document.html.vrfy, HOW-TO-VERIFY.txt} into
     gallery/bundles/<slug>.zip.

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

  1. Extract all files in this bundle into a single folder, keeping
     {docfile} and its {vrfyfile} sidecar together.

  2. Verify the document with TrustDID Verify: go to https://trustdid.ca
     and open {docfile} (or its {vrfyfile} sidecar).

A passing result confirms two things: the document was signed by {did}
(a public identity anchored in DNS), and it has not been altered by a
single byte since. Change one character and verification fails.
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
        print("built bundle             : bundles/" + slug + ".zip")

    print("done.")


if __name__ == "__main__":
    main()
