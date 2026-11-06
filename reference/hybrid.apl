Harvest←{
  Squares←{
    tl←⍵∧((⍴⍵)↑0 1↓⍵)∧((⍴⍵)↑1 0↓⍵)∧(⍴⍵)↑1 1↓⍵
    tl∨((-⍴⍵)↑0 ¯1↓tl)∨((-⍴⍵)↑¯1 0↓tl)∨(-⍴⍵)↑¯1 ¯1↓tl
  }
  ready←⍵=Ripe
  (⍵=Rotten)∨(Squares ready)∨ready∧~Squares (⍵=Growing)∨⍵=Ripe
}
