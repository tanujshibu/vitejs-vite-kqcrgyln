"""
Run this once from your project root:
  python generate_onboarding_images.py

Requires: pip install requests
Saves images to: public/onboarding/
Cost: ~$0.25 total (11 images @ fal-ai/flux/dev)
"""

import requests, time, os, urllib.request

FAL_KEY = "e079a554-7f96-4762-9c40-b532addb202b:f7ba9f8c251ad878a6b532af6498d083"
OUT_DIR = os.path.join(os.path.dirname(__file__), "public", "onboarding")
os.makedirs(OUT_DIR, exist_ok=True)

IMAGES = [
    ("gender_male",   "dark cinematic athletic male physique silhouette from behind, dramatic side rim lighting, gym environment, near-black background, moody editorial fitness photography, no face"),
    ("gender_female", "dark cinematic athletic female silhouette, strong confident pose, dramatic purple rim lighting, near-black background, moody editorial fitness photography, no face"),
    ("freq_high",     "dark abstract muscle fiber texture extreme close-up, deep crimson and orange bioluminescent glow, macro photography, black background, cellular biology aesthetic"),
    ("freq_med",      "dark minimalist rest scene, single beam of soft blue light, deep shadows, zen stillness, cinematic, near-black background"),
    ("freq_low",      "two intense spotlights cutting through smoke in a dark empty gym, dramatic high contrast, cinematic, deep black background, minimalist"),
    ("caffeine_high", "dark macro coffee pour, steam rising, espresso crema close-up, near-black background, dramatic single light source, moody editorial"),
    ("caffeine_med",  "dark abstract electric energy visualization, sharp orange sparks and plasma, black background, macro, high contrast dramatic"),
    ("caffeine_low",  "dark early morning mist over water, single ray of light, calm and still, cinematic landscape, deep blue-black tones"),
    ("sleep",         "dark cinematic bedroom, moonlight beam through window, deep blue-black shadows, ethereal atmospheric, soft glow, no people"),
    ("soreness",      "dark macro human muscle anatomy detail, deep red inflammatory glow, dramatic lighting, biological texture, black background, cinematic"),
    ("brain_fog",     "dark neural network visualization, glowing violet-purple synapses and nodes, deep space bioluminescent aesthetic, macro, black background"),
]

HEADERS = {
    "Authorization": f"Key {FAL_KEY}",
    "Content-Type": "application/json"
}

for name, prompt in IMAGES:
    out_path = os.path.join(OUT_DIR, f"{name}.jpg")
    if os.path.exists(out_path):
        print(f"  skip {name} (already exists)")
        continue

    print(f"  generating {name}...", end=" ", flush=True)
    r = requests.post(
        "https://fal.run/fal-ai/flux/dev",
        headers=HEADERS,
        json={
            "prompt": prompt + ", cinematic color grading, 8k, photorealistic",
            "image_size": "portrait_16_9",
            "num_images": 1,
            "guidance_scale": 3.5,
            "num_inference_steps": 28,
        },
        timeout=120
    )

    if r.status_code != 200:
        print(f"ERROR {r.status_code}: {r.text[:120]}")
        continue

    img_url = r.json()["images"][0]["url"]
    urllib.request.urlretrieve(img_url, out_path)
    kb = os.path.getsize(out_path) // 1024
    print(f"saved ({kb}kb)")
    time.sleep(0.3)

print("\nAll done! Images saved to public/onboarding/")
print("Now tell Claude and we'll wire them into the app.")
