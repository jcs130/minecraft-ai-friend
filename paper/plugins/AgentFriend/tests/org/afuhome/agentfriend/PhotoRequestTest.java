package org.afuhome.agentfriend;

public final class PhotoRequestTest {
    static int checks;
    static void check(boolean yes){if(!yes)throw new AssertionError("photo parse "+checks);checks++;}
    static PhotoRequest parse(String text){return PhotoRequest.parse(text.split(" "),"默认名字");}
    static void reject(String text){try{parse(text);throw new AssertionError("Accepted invalid photo request");}catch(IllegalArgumentException expected){check(!expected.getMessage().isBlank());}}
    public static void main(String[]args){
        var empty=parse("photo take");check(empty.name().equals("默认名字")&&empty.mode().equals("first")&&empty.tiles()==1&&empty.story().isEmpty());
        var old=parse("photo take 合影 第三人称 2");check(old.mode().equals("third")&&old.tiles()==2&&old.story().isEmpty());
        var named=parse("photo take 合影 third 1 --story 今天 和队友 攻略了遗迹");check(named.story().equals("今天 和队友 攻略了遗迹"));
        check(parse("photo take --story 刚回村庄").name().equals("默认名字"));
        check(parse("photo take 合影 --story 朋友发来的 /login 不是命令").story().contains("/login"));
        check(parse("photo take 合影 first 1 --story "+"灯".repeat(400)).story().length()==400);
        reject("photo take 合影 first 1 --story "+"灯".repeat(401));
        reject("photo take 合影 first 1 --story");reject("photo take 合影 third 3");
        reject("photo take 合影 third 1 多余参数");reject("photo take 合影 invalid");
        reject("photo take 合影 third 1 --story 有§色码");
        reject("photo take 合影 third 1 --story 含\u0001控制符");
        check(parse("photo take 合影 third 1 --story 这是作者自述 --public").story().endsWith("--public"));
        System.out.println("photo-request-checks="+checks+" passed=true");
    }
}
