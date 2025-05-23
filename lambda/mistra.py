import requests

# === CONFIGURATION ===
MODEL_NAME = "mixtral"                 # 🟢 Switch to Mixtral model
TRANSCRIPT_FILE = "vid2.txt"
OUTPUT_FILE = "questions.txt"
CHUNK_WORD_LIMIT = 1500

# === LOAD TRANSCRIPT ===
with open(TRANSCRIPT_FILE, "r", encoding="utf-8") as f:
    text = f.read()

words = text.split()
chunks = [" ".join(words[i:i + CHUNK_WORD_LIMIT]) for i in range(0, len(words), CHUNK_WORD_LIMIT)]

# === PROCESS CHUNKS ===
all_questions = []

for idx, chunk in enumerate(chunks):
    print(f"🔄 Sending chunk {idx + 1}/{len(chunks)}")

    prompt = (
        "Analyze the following interview transcript written in Ukrainian.\n"
        "Extract only the questions related to front-end development "
        "(e.g., HTML, CSS, JavaScript, React, Vue, UI/UX, browser compatibility, responsive design, frontend testing).\n\n"
        "Correct grammar and rewrite each question in clear, concise Ukrainian.\n"
        "Output only the cleaned list of questions, one per line.\n"
        "Do not include any other commentary.\n\n"
        f"Transcript:\n\n{chunk}"
    )

    response = requests.post("http://localhost:11434/api/generate", json={
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False
    })

    if response.status_code == 200:
        result = response.json().get("response", "").strip()
        all_questions.append(f"### Chunk {idx + 1} ###\n{result}")
    else:
        print(f"❌ Error with chunk {idx + 1}: {response.text}")
        all_questions.append(f"### Chunk {idx + 1} ###\n[ERROR]")

# === SAVE RESULTS ===
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.write("\n\n".join(all_questions))

print(f"\n✅ Done! Extracted questions saved to: {OUTPUT_FILE}")
