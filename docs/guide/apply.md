# Apply и diffs

## Apply из чата

Когда модель отдаёт codeblock, у блока есть кнопка **Apply** — прогон изменения в целевой файл.

### Fast Apply

Модель выдаёт Search/Replace блоки:

```text
<<<<<<< ORIGINAL
// старый код
=======
// новый код
>>>>>>> UPDATED
```

Удобно для больших файлов: не нужно переписывать всё целиком.

### Slow Apply

Полный rewrite файла. Медленнее, но надёжнее, когда структура сильно меняется.

Режим выбирается в Settings → Опции (Apply).

## Command bar

После стриминга правок появляется панель для ревью:

- accept / reject одного hunk;
- next / prev diff;
- next / prev файл с изменениями;
- accept / reject всего файла;
- accept all / reject all.

Action IDs: см. [справочник](/reference/actions).

## Agent edits

Когда Agent вызывает `edit_file` / `rewrite_file`, пользователь видит те же red/green diffs и тот же command bar.
