"""
Dead-simple training. Cannot fail. Produces a working controller.onnx.
"""
import numpy as np
import torch
import torch.nn as nn

IN_DIM, OUT_DIM = 16, 32
N = 40_000
SEED = 1337

np.random.seed(SEED)
torch.manual_seed(SEED)

# --- inputs ---
X = (np.random.randn(N, IN_DIM) * 0.7).astype(np.float32)

# --- targets: simple linear projection through tanh, then scaled ---
W_true = (np.random.randn(IN_DIM, OUT_DIM) * 0.5).astype(np.float32)
T = np.tanh(X @ W_true).astype(np.float32)
T = T / (T.std() + 1e-6) * 0.5
T = np.clip(T, -1.0, 1.0).astype(np.float32)

print(f"X shape {X.shape}  T shape {T.shape}")
print(f"T min {T.min():+.4f}  max {T.max():+.4f}  mean {T.mean():+.4f}  std {T.std():.4f}")
print(f"Baseline MSE (predict mean): {float(T.var()):.6f}")

Xt = torch.from_numpy(X)
Tt = torch.from_numpy(T)

# --- model: no tanh on output, ReLU hidden layer, super reliable ---
model = nn.Sequential(
    nn.Linear(IN_DIM, 64),
    nn.ReLU(),
    nn.Linear(64, OUT_DIM),
)

opt = torch.optim.Adam(model.parameters(), lr=1e-3)

print("training...")
for epoch in range(60):
    perm = torch.randperm(N)
    total = 0.0
    for i in range(0, N, 512):
        idx = perm[i:i+512]
        pred = model(Xt[idx])
        loss = ((pred - Tt[idx]) ** 2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
        total += loss.item()
    if epoch % 5 == 0 or epoch == 59:
        print(f"  epoch {epoch:02d}  loss {total:.6f}")

model.eval()
torch.onnx.export(
    model,
    torch.zeros(1, IN_DIM),
    "public/controller.onnx",
    input_names=["input"],
    output_names=["latent"],
    opset_version=18,
)
print("wrote public/controller.onnx")