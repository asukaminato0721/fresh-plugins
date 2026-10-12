/* outer /* nested */ comment */
@verify(true)
method Max(x: int, y: int) returns (m: int)
  requires x >= 0
  ensures m >= x && m >= y
{
  var message := @"verified ""value""";
  m := if x > y then x else y;
  print message;
}
