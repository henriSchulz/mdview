# Heading one

A paragraph with *emphasis*, _underscore emphasis_, **strong**, __underscore strong__,
***both***, ~~struck~~, `code`, ``code with ` tick``, a [link](https://example.com "Title"),
an <https://autolink.example>, a bare https://linkified.example/path and an image
![alt *text*](img.png "Image title").

Hard break with two spaces  
next line, and with a backslash\
last line. Entities &amp; &copy; &#35; and escapes \* \_ \# \\ stay.

Setext heading
==============

Second level
------------

## ATX with closing hashes ##

- bullet one
- bullet two
  continued lazily
    - nested with four spaces
    - second nested

* star list

+ plus list

1. one
2. two
   1. nested ordered
   2. more

7) starts at seven
8) eight

- loose item

- another loose item

  with a second paragraph

  ```sh
  echo "code in a list"
  ```

> A quote
> over two lines
>
> > nested quote
>
> - list in a quote

***

___

    indented code
    second line

```python title="x.py" {1,3}
def f():
    return 1
```

~~~
tilde fence
~~~

| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| `x`  | **y**  | \|    |

|compact|table|
|-|-|
|1|2|

<details>
<summary>HTML block</summary>

Inside.

</details>

<!-- a comment -->

Text with <span style="color:red">inline html</span> and a <br> break.

[ref link][ref] and [collapsed][] and [shortcut] and [missing][nope].

[ref]: https://example.com/ref  "Ref title"
[collapsed]: <https://example.com/collapsed>
[shortcut]: https://example.com/shortcut
