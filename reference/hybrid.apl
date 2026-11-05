Harvest←{
  Blocks←{
    tl←⍵∧((⍴⍵)↑0 1↓⍵)∧((⍴⍵)↑1 0↓⍵)∧(⍴⍵)↑1 1↓⍵
    tl∨((-⍴⍵)↑0 ¯1↓tl)∨((-⍴⍵)↑¯1 0↓tl)∨(-⍴⍵)↑¯1 ¯1↓tl
  }
  ripe←⍵=3
  (⍵=4)∨(Blocks ripe)∨ripe∧~Blocks ⍵∊2 3
}
