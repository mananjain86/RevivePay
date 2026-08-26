import math

def hash_string(s: str) -> int:
    """Simple string hash -> 32-bit integer."""
    h = 0
    for char in s:
        h = ((h << 5) - h) + ord(char)
        h = h & 0xFFFFFFFF # 32-bit uint mask
    # Convert uint32 to int32 to match JS Math.abs bitwise behavior more closely, 
    # but since JS does `abs`, we just do abs on the signed 32bit int.
    # Actually in JS `hash & hash` converts to signed 32-bit. 
    signed_h = h if h < 0x80000000 else h - 0x100000000
    return abs(signed_h)

def create_seeded_rng(case_id: str):
    """
    mulberry32 - a fast, deterministic 32-bit PRNG.
    Returns a function that produces a new pseudo-random float [0, 1) on each call.
    """
    seed = hash_string(case_id)
    
    def rng():
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        
        # We need JS imul behavior: signed 32-bit multiplication
            
        def signed_32(val):
            val = val & 0xFFFFFFFF
            return val if val < 0x80000000 else val - 0x100000000
            
        def unsigned_right_shift(val, shift):
            return (val & 0xFFFFFFFF) >> shift

        def python_imul(a, b):
            return signed_32(signed_32(a) * signed_32(b))

        t = python_imul(seed ^ unsigned_right_shift(seed, 15), 1 | seed)
        t = (t + python_imul(t ^ unsigned_right_shift(t, 7), 61 | t)) ^ t
        
        result = ((t ^ unsigned_right_shift(t, 14)) & 0xFFFFFFFF) / 4294967296.0
        return result

    return rng
