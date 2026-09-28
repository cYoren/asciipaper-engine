using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace Asciipaper;

// JSON through the framework's JavaScriptSerializer, plus an indented writer: wallpaper specs are
// meant to be read and edited by people.
static class Json
{
    static readonly JavaScriptSerializer serializer = new() { MaxJsonLength = int.MaxValue };

    public static object Parse(string text) => serializer.DeserializeObject(text);
    public static Dictionary<string, object> Object(string text) => Parse(text) as Dictionary<string, object> ?? new();
    public static string Compact(object value) => serializer.Serialize(value);

    public static string Pretty(object value, int depth = 0)
    {
        string pad = new(' ', depth * 2), inner = new(' ', depth * 2 + 2);
        switch (value)
        {
            case IDictionary<string, object> map when map.Count > 0:
                return "{\n" + string.Join(",\n", map.Select(p => inner + Compact(p.Key) + ": " + Pretty(p.Value, depth + 1))) + "\n" + pad + "}";
            case string or null or bool: return Compact(value);
            case IEnumerable list when list.Cast<object>().All(x => x is not IDictionary and not IList):
                return "[" + string.Join(", ", list.Cast<object>().Select(Compact)) + "]";
            case IEnumerable list:
                return "[\n" + string.Join(",\n", list.Cast<object>().Select(x => inner + Pretty(x, depth + 1))) + "\n" + pad + "]";
            case double d: return d.ToString("R", CultureInfo.InvariantCulture);
            case decimal m: return m.ToString(CultureInfo.InvariantCulture);
            default: return Compact(value);
        }
    }

    public static string Str(this Dictionary<string, object> map, string key, string fallback = null) =>
        map != null && map.TryGetValue(key, out var v) && v is string s ? s : fallback;

    public static double Num(this Dictionary<string, object> map, string key, double fallback) =>
        map != null && map.TryGetValue(key, out var v) && v != null && v is not string && v is not bool &&
        double.TryParse(System.Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : fallback;
}
